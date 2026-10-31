/**
 * @module cmdFlightLogs
 * @description Convex functions for the History tab cloud sync.
 *
 * Each row is keyed on the client-generated `clientId` so local + cloud
 * stay in lockstep across multi-device usage. Conflict resolution is
 * last-write-wins on `updatedAt` (server is authoritative). Sealed
 * records (sign-and-lock) are tamper-protected: only volatile fields can be
 * patched without first unsealing.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { RECORD_VALIDATOR } from "./lib/flightLogValidator";
import { sealTransition } from "./lib/flightLogSeal";
import {
  applyAggregateDelta,
  contributionOf,
  scanAggregateFallback,
  subtractContribution,
} from "./lib/flightLogAggregate";

async function requireUser(ctx: QueryCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

// ── Queries ──────────────────────────────────────────────────

/**
 * The signed-in user's flight logs, newest-first by `startTime`, one page at
 * a time, for the History tab and cloud-sync bridge.
 *
 * Optional `since` cutoff filters to rows whose `updatedAt` is strictly
 * greater than the cutoff. The
 * filter runs after pagination on the page array, so callers using
 * `since` should expect short or empty pages until the cursor reaches
 * older rows. For incremental sync the recommended pattern is to walk
 * with no `since` and stop early when the local store has already seen
 * a row.
 */
export const listPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        page: [] as Array<never>,
        isDone: true,
        continueCursor: "",
      };
    }
    const result = await ctx.db
      .query("cmd_flightLogs")
      .withIndex("by_user_startTime", (qb) => qb.eq("userId", userId))
      .order("desc")
      .paginate(args.paginationOpts);
    if (args.since !== undefined) {
      const cutoff = args.since;
      return {
        ...result,
        page: result.page.filter((r) => r.updatedAt > cutoff),
      };
    }
    return result;
  },
});

/**
 * Total flight-log count for the current user. Separate from
 * {@link listPaginated} so the History tab can show "X of Y" without
 * defeating pagination. Reads the denormalized aggregate row instead of
 * scanning every flight log.
 */
export const getCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return 0;
    const aggregate = await ctx.db
      .query("cmd_flightLogAggregates")
      .withIndex("by_userId", (qb) => qb.eq("userId", userId))
      .unique();
    if (aggregate) return aggregate.count;
    const fallback = await scanAggregateFallback(ctx, userId);
    return fallback.count;
  },
});

export const get = query({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("cmd_flightLogs")
      .withIndex("by_user_clientId", (qb) =>
        qb.eq("userId", userId).eq("clientId", args.clientId),
      )
      .unique();
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { totalFlights: 0, totalHours: 0, totalKm: 0, batteryHours: 0 };
    }
    // Read the denormalized aggregate instead of scanning + deserializing
    // every flight log (each row carries large path/events/media arrays).
    const aggregate = await ctx.db
      .query("cmd_flightLogAggregates")
      .withIndex("by_userId", (qb) => qb.eq("userId", userId))
      .unique();
    const totals = aggregate
      ? {
          count: aggregate.count,
          totalSeconds: aggregate.totalSeconds,
          totalMeters: aggregate.totalMeters,
          batteryHours: aggregate.batteryHours,
        }
      : await scanAggregateFallback(ctx, userId);
    return {
      totalFlights: totals.count,
      totalHours: totals.totalSeconds / 3600,
      totalKm: totals.totalMeters / 1000,
      batteryHours: totals.batteryHours,
    };
  },
});

// ── Mutations ────────────────────────────────────────────────

export const upsert = mutation({
  args: { record: v.object(RECORD_VALIDATOR) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { record } = args;

    const existing = await ctx.db
      .query("cmd_flightLogs")
      .withIndex("by_user_clientId", (qb) =>
        qb.eq("userId", userId).eq("clientId", record.clientId),
      )
      .unique();

    if (existing) {
      // Last-write-wins: ignore patches that are not newer than the server row.
      if (record.updatedAt <= existing.updatedAt) {
        return { status: "stale" as const, id: existing._id };
      }

      // Tamper protection and seal bookkeeping (see `sealTransition`).
      const sealState = await sealTransition(
        existing as unknown as Record<string, unknown>,
        record as Record<string, unknown>,
      );

      await ctx.db.patch(existing._id, { ...record, ...sealState });
      // Apply the difference between the old and new revision to the
      // per-user aggregate so stats/getCount stay correct without a scan.
      const oldContribution = contributionOf(existing);
      const newContribution = contributionOf(record);
      await applyAggregateDelta(ctx, userId, {
        count: newContribution.count - oldContribution.count,
        totalSeconds: newContribution.totalSeconds - oldContribution.totalSeconds,
        totalMeters: newContribution.totalMeters - oldContribution.totalMeters,
        batteryHours: newContribution.batteryHours - oldContribution.batteryHours,
      });
      return { status: "updated" as const, id: existing._id };
    }

    const id = await ctx.db.insert("cmd_flightLogs", { userId, ...record });
    // New row: add its contribution to the per-user aggregate.
    await applyAggregateDelta(ctx, userId, contributionOf(record));
    return { status: "inserted" as const, id };
  },
});

export const remove = mutation({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query("cmd_flightLogs")
      .withIndex("by_user_clientId", (qb) =>
        qb.eq("userId", userId).eq("clientId", args.clientId),
      )
      .unique();
    if (!existing) return { status: "missing" as const };
    await ctx.db.delete(existing._id);
    // Subtract the removed row's contribution from the per-user aggregate.
    await applyAggregateDelta(
      ctx,
      userId,
      subtractContribution(contributionOf(existing)),
    );
    return { status: "deleted" as const };
  },
});
