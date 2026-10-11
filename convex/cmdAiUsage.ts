import { query, mutation, internalMutation, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * AI feature quota. The caller checks `getRemaining` before spending an
 * upstream call and calls `record` only after an answer was delivered, so a
 * failed or empty upstream answer never costs a unit. There is deliberately no
 * client-callable refund: a refund mutation would let any caller mint quota.
 */

/**
 * Get the start of the current week (Monday 00:00 UTC).
 */
function getWeekStart(): number {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.getTime();
}

function getWeeklyLimit(): number {
  const raw = process.env.AI_PID_WEEKLY_LIMIT;
  if (!raw) return 3;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

/** Units of `feature` the user has spent since this week's Monday 00:00 UTC. */
async function usedThisWeek(ctx: QueryCtx, userId: string, feature: string): Promise<number> {
  const weekStart = getWeekStart();
  const rows = await ctx.db
    .query("cmd_ai_usage")
    .withIndex("by_userId_feature", (q) => q.eq("userId", userId).eq("feature", feature))
    .collect();
  return rows.filter((u) => u.usedAt >= weekStart).length;
}

export const getRemaining = query({
  args: { feature: v.optional(v.string()) },
  handler: async (ctx, { feature: featureArg }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const feature = featureArg ?? "pid_analysis";
    const weeklyLimit = getWeeklyLimit();
    const used = await usedThisWeek(ctx, userId, feature);

    return {
      remaining: Math.max(0, weeklyLimit - used),
      weeklyLimit,
      usedThisWeek: used,
    };
  },
});

/**
 * Record one delivered use. The limit is re-checked in the write transaction,
 * so two concurrent requests that both passed `getRemaining` with one unit
 * left spend it once: the second returns `recorded: false`.
 */
export const record = mutation({
  args: { feature: v.string() },
  handler: async (ctx, { feature }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const weeklyLimit = getWeeklyLimit();
    const used = await usedThisWeek(ctx, userId, feature);
    if (used >= weeklyLimit) {
      return { recorded: false, remaining: 0, weeklyLimit };
    }

    await ctx.db.insert("cmd_ai_usage", {
      userId,
      feature,
      usedAt: Date.now(),
    });

    return {
      recorded: true,
      remaining: weeklyLimit - used - 1,
      weeklyLimit,
    };
  },
});

/**
 * A usage row older than this can no longer count toward any quota: the week
 * starts on the most recent Monday 00:00 UTC, never more than seven days ago.
 */
const USAGE_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;
/** Bounded so a backlog cannot blow the per-call limits. */
const USAGE_PRUNE_BATCH = 256;

/**
 * Cron job: delete usage rows past every quota window. One row lands per AI
 * call, so without this the table grows for the lifetime of the deployment.
 * Ranges `by_usedAt` so the cost tracks what is deleted, and reschedules while
 * a full batch went.
 */
export const pruneOldUsage = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const cutoff = Date.now() - USAGE_RETENTION_MS;
    const stale = await ctx.db
      .query("cmd_ai_usage")
      .withIndex("by_usedAt", (q) => q.lt("usedAt", cutoff))
      .take(USAGE_PRUNE_BATCH);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    if (stale.length === USAGE_PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.cmdAiUsage.pruneOldUsage, {});
    }
    return { deleted: stale.length };
  },
});
