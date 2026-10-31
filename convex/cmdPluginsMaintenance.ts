/**
 * @module cmdPluginsMaintenance
 * @description Internal plugin-registry functions: bundle ownership recording
 * for `cmdPlugins.storeBundle` and the plugin-event retention sweep.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

export const recordBundleOwner = internalMutation({
  args: { userId: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { userId, storageId }) => {
    await ctx.db.insert("cmd_pluginBundles", { userId, storageId, createdAt: Date.now() });
  },
});

/** Plugin lifecycle events are kept for 30 days. */
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Bounded so a backlog cannot blow the per-call limits. */
const EVENT_PRUNE_BATCH = 256;

/**
 * Cron job: delete plugin events past the retention window.
 *
 * `cmd_pluginEvents` is append-only and written at machine cadence (every
 * install, enable, start, stop, crash and capability denial), and the table's
 * own schema comment promised this sweep while nothing swept it. Reads through
 * `by_createdAt` so the cost tracks what is deleted, not the table.
 */
export const pruneOldEvents = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const cutoff = Date.now() - EVENT_RETENTION_MS;
    const stale = await ctx.db
      .query("cmd_pluginEvents")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(EVENT_PRUNE_BATCH);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    // A full batch means more may be past retention: keep draining now rather
    // than letting the backlog outgrow one batch per cron tick.
    if (stale.length === EVENT_PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.cmdPluginsMaintenance.pruneOldEvents, {});
    }
    return { deleted: stale.length };
  },
});
