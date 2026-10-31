/**
 * @module cmdPairingCleanup
 * @description Internal pairing sweeps: expired unclaimed codes, stale
 * rate-limit buckets and browser sessions (both cron-driven), and the per-device
 * wipe used by unpair and operator recovery.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  BROWSER_SESSION_TTL_MS,
} from "./lib/pairingCodes";
import { deleteLiveness } from "./cmdDroneLiveness";
import { RECORD_PURGE_BATCH, deleteDeviceRecords } from "./pluginRecords";

// Upper bound on rows deleted per sweep so one call stays within transaction
// limits; a full batch reschedules the sweep until the range is drained.
const CLEAN_EXPIRED_BATCH = 256;

/**
 * Cron job: clean expired UNCLAIMED pairing requests.
 *
 * Internal (cron-only): a public no-auth mutation let any client trigger the
 * scan on demand. It ranges `by_claimedBy_expiresAt` over unclaimed rows only,
 * so kept rows never occupy the head of the range, and reschedules itself
 * while a full batch was deleted so a backlog drains without waiting for the
 * next tick.
 *
 * A CLAIMED row is never deleted. `expiresAt` bounds how long an unclaimed
 * CODE stays offerable; it is not a lifetime for the pairing itself. A
 * re-registering agent reads `alreadyClaimed` off its claimed row; deleting
 * that row would make it display a fresh pairing code for a drone that was
 * already paired.
 */
export const cleanExpiredRequests = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const now = Date.now();
    const expired = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_claimedBy_expiresAt", (q) =>
        q.eq("claimedBy", undefined).lt("expiresAt", now),
      )
      .take(CLEAN_EXPIRED_BATCH);
    for (const req of expired) {
      await ctx.db.delete(req._id);
    }
    if (expired.length === CLEAN_EXPIRED_BATCH) {
      await ctx.scheduler.runAfter(0, internal.cmdPairingCleanup.cleanExpiredRequests, {});
    }
    return { deleted: expired.length };
  },
});

/**
 * Cron job: retire settled rate-limit buckets and dead browser sessions.
 *
 * Both tables are written by anonymous callers, so both grow without a sweep.
 * A bucket is settled once its window has elapsed AND its lockout has expired —
 * deleting a bucket that is still locked would hand an attacker a reset, so the
 * range is walked by `lastAttemptAt` and the lockout is re-checked per row.
 */
export const cleanExpiredSecurityState = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ deletedBuckets: number; deletedSessions: number }> => {
    const now = Date.now();
    // One day of idle is far past every policy window and every lockout ceiling.
    const settledBefore = now - 24 * 60 * 60 * 1000;
    const buckets = await ctx.db
      .query("cmd_authAttempts")
      .withIndex("by_lastAttemptAt", (q) => q.lt("lastAttemptAt", settledBefore))
      .take(CLEAN_EXPIRED_BATCH);
    let deletedBuckets = 0;
    for (const bucket of buckets) {
      if (bucket.lockedUntil > now) continue;
      await ctx.db.delete(bucket._id);
      deletedBuckets++;
    }

    const sessions = await ctx.db
      .query("cmd_browserSessions")
      .withIndex("by_lastSeenAt", (q) =>
        q.lt("lastSeenAt", now - BROWSER_SESSION_TTL_MS),
      )
      .take(CLEAN_EXPIRED_BATCH);
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    // Drain while a batch came back full. A skipped (still-locked) bucket stays
    // in the range, so only a batch that deleted every row it read reschedules;
    // otherwise a range of locked rows would spin the scheduler.
    if (
      deletedBuckets === CLEAN_EXPIRED_BATCH ||
      sessions.length === CLEAN_EXPIRED_BATCH
    ) {
      await ctx.scheduler.runAfter(0, internal.cmdPairingCleanup.cleanExpiredSecurityState, {});
    }
    return { deletedBuckets, deletedSessions: sessions.length };
  },
});

/**
 * Per-device, per-table delete cap for one wipe invocation. A device with a
 * long command history or many exported log windows must not take the whole
 * transaction over its document limit and fail the unpair; `truncated` reports
 * that a second pass is needed rather than silently leaving rows behind.
 */
const WIPE_BATCH = 256;

/**
 * Wipe every row keyed to a device: pairing requests, the drone row, its
 * status snapshot, its queued/settled commands, the plugin records about it
 * and its exported log windows (blobs included).
 *
 * Used by admin recovery AND by `cmdDrones.unpairDrone`. Unpairing used to
 * delete the `cmd_drones` row alone, which left the status row — last LAN IP,
 * mDNS host, the whole telemetry snapshot — keyed by deviceId with no owner.
 * Re-pairing the same deviceId from a DIFFERENT account then adopted the
 * previous operator's last-known state, and the orphaned rows were unreachable
 * by any retention sweep because the terminal-command prune only touches
 * settled rows and nothing swept status at all.
 *
 * Flight logs and mission records are deliberately NOT wiped: they belong to
 * the operator's account, not to the pairing.
 */
export const wipeByDeviceIds = internalMutation({
  args: { deviceIds: v.array(v.string()) },
  handler: async (ctx, { deviceIds }) => {
    let removedRequests = 0;
    let removedDrones = 0;
    let removedStatus = 0;
    let removedCommands = 0;
    let removedPluginRecords = 0;
    let removedLogWindows = 0;
    let truncated = false;
    for (const deviceId of deviceIds) {
      const reqs = await ctx.db
        .query("cmd_pairingRequests")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
        .take(WIPE_BATCH + 1);
      if (reqs.length > WIPE_BATCH) truncated = true;
      for (const r of reqs.slice(0, WIPE_BATCH)) {
        await ctx.db.delete(r._id);
        removedRequests++;
      }
      const drones = await ctx.db
        .query("cmd_drones")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
        .take(WIPE_BATCH + 1);
      if (drones.length > WIPE_BATCH) truncated = true;
      for (const d of drones.slice(0, WIPE_BATCH)) {
        await deleteLiveness(ctx, d._id);
        await ctx.db.delete(d._id);
        removedDrones++;
      }
      const statuses = await ctx.db
        .query("cmd_droneStatus")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
        .take(WIPE_BATCH + 1);
      if (statuses.length > WIPE_BATCH) truncated = true;
      for (const s of statuses.slice(0, WIPE_BATCH)) {
        await ctx.db.delete(s._id);
        removedStatus++;
      }
      // Queued commands included: a `pending` row for an unpaired device is
      // never reaped by the terminal prune, and would be handed straight to
      // the agent if the device were re-paired.
      const commands = await ctx.db
        .query("cmd_droneCommands")
        .withIndex("by_deviceId_createdAt", (q) => q.eq("deviceId", deviceId))
        .take(WIPE_BATCH + 1);
      if (commands.length > WIPE_BATCH) truncated = true;
      for (const c of commands.slice(0, WIPE_BATCH)) {
        await ctx.db.delete(c._id);
        removedCommands++;
      }
      // Records a plugin kept about this node, under any account: a re-paired
      // node must not surface its previous operator's plugin history.
      // Batched smaller than WIPE_BATCH because a record body runs to 64 KiB.
      const records = await deleteDeviceRecords(ctx, deviceId, RECORD_PURGE_BATCH);
      if (records.truncated) truncated = true;
      removedPluginRecords += records.removed;
      // Blob before row, matching the retention sweep: a row pointing at a
      // missing blob is visible; a blob nothing references is storage nobody
      // can find.
      const windows = await ctx.db
        .query("logd_windows")
        .withIndex("by_device_pushedAt", (q) => q.eq("deviceId", deviceId))
        .take(WIPE_BATCH + 1);
      if (windows.length > WIPE_BATCH) truncated = true;
      for (const w of windows.slice(0, WIPE_BATCH)) {
        await ctx.storage.delete(w.storageId);
        await ctx.db.delete(w._id);
        removedLogWindows++;
      }
    }
    return {
      removedRequests,
      removedDrones,
      removedStatus,
      removedCommands,
      removedPluginRecords,
      removedLogWindows,
      truncated,
    };
  },
});
