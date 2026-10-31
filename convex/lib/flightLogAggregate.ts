/**
 * @module convex/lib/flightLogAggregate
 * @description The denormalized per-user flight-log aggregate behind
 * `cmdFlightLogs` stats and getCount.
 *
 * @license GPL-3.0-only
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";

// ── Aggregate maintenance ────────────────────────────────────
//
// stats + getCount used to .collect() every flight-log row (each loading the
// full document with large path/events/media arrays) just to sum four
// numbers. We instead keep one denormalized per-user row and update it
// incrementally on every upsert/remove, mirroring the prior full-scan
// semantics: each persisted row contributes its duration/distance/battery
// regardless of the soft-delete flag (the scan summed those rows too), and a
// hard remove subtracts the contribution.

interface AggregateContribution {
  count: number;
  totalSeconds: number;
  totalMeters: number;
  batteryHours: number;
}

/**
 * One flight log's contribution to the per-user aggregate. Matches the
 * arithmetic the prior full-scan used in {@link stats}.
 */
export function contributionOf(
  record: { duration?: number; distance?: number; batteryUsed?: number },
): AggregateContribution {
  const duration = record.duration ?? 0;
  const distance = record.distance ?? 0;
  const batteryUsed = record.batteryUsed ?? 0;
  return {
    count: 1,
    totalSeconds: duration,
    totalMeters: distance,
    // Crude proxy: battery % used × duration ÷ 100. Mirrors the prior scan.
    batteryHours: (batteryUsed / 100) * (duration / 3600),
  };
}

/**
 * Apply a signed delta (an inserted/removed contribution, or the difference
 * between an old and new revision) to the user's aggregate row, creating it
 * on first write. Values are clamped at zero so floating-point drift across
 * many add/subtract cycles can never push a total negative.
 */
export async function applyAggregateDelta(
  ctx: MutationCtx,
  userId: string,
  delta: AggregateContribution,
): Promise<void> {
  const existing = await ctx.db
    .query("cmd_flightLogAggregates")
    .withIndex("by_userId", (qb) => qb.eq("userId", userId))
    .unique();
  const now = Date.now();
  if (!existing) {
    // No aggregate row yet for a user who may already have flight history.
    // The row that triggered this delta is already written to cmd_flightLogs,
    // so seed the aggregate from a bounded scan of the user's current rows
    // (not from this single delta) — otherwise the user's entire prior history
    // would be dropped from stats/getCount the moment the first new flight
    // lands. Steady state patches the row below and never rescans.
    const seed = await scanAggregateFallback(ctx, userId);
    await ctx.db.insert("cmd_flightLogAggregates", {
      userId,
      count: Math.max(0, seed.count),
      totalSeconds: Math.max(0, seed.totalSeconds),
      totalMeters: Math.max(0, seed.totalMeters),
      batteryHours: Math.max(0, seed.batteryHours),
      updatedAt: now,
    });
    return;
  }
  await ctx.db.patch(existing._id, {
    count: Math.max(0, existing.count + delta.count),
    totalSeconds: Math.max(0, existing.totalSeconds + delta.totalSeconds),
    totalMeters: Math.max(0, existing.totalMeters + delta.totalMeters),
    batteryHours: Math.max(0, existing.batteryHours + delta.batteryHours),
    updatedAt: now,
  });
}

export function subtractContribution(
  c: AggregateContribution,
): AggregateContribution {
  return {
    count: -c.count,
    totalSeconds: -c.totalSeconds,
    totalMeters: -c.totalMeters,
    batteryHours: -c.batteryHours,
  };
}

// Transitional fallback bound. Existing users have flight logs but no
// aggregate row yet (it is built incrementally on the next upsert/remove);
// until then stats/getCount fall back to a bounded scan so they do not read
// as zero. New activity populates the aggregate and the fast path takes over.
const AGGREGATE_FALLBACK_SCAN = 2000;

/**
 * Sum a bounded slice of a user's flight logs. Used only as the transitional
 * fallback when the denormalized aggregate row does not exist yet; the steady
 * state reads the single aggregate row and never reaches here.
 */
export async function scanAggregateFallback(
  ctx: QueryCtx,
  userId: string,
): Promise<AggregateContribution> {
  const rows = await ctx.db
    .query("cmd_flightLogs")
    .withIndex("by_userId", (qb) => qb.eq("userId", userId))
    .take(AGGREGATE_FALLBACK_SCAN);
  const total: AggregateContribution = {
    count: 0,
    totalSeconds: 0,
    totalMeters: 0,
    batteryHours: 0,
  };
  for (const r of rows) {
    const c = contributionOf(r);
    total.count += c.count;
    total.totalSeconds += c.totalSeconds;
    total.totalMeters += c.totalMeters;
    total.batteryHours += c.batteryHours;
  }
  return total;
}
