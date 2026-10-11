/**
 * @module cmdDroneLiveness
 * @description Per-drone heartbeat liveness, kept apart from `cmd_drones`.
 *
 * `lastSeen` moves on every agent heartbeat. While it lived on the
 * `cmd_drones` row, every heartbeat of every drone invalidated every
 * `listMyDrones` subscriber, which re-ran and re-shipped the whole fleet list
 * although no fleet-card pill had changed. Liveness now lives in its own
 * small table: the heartbeat writes it every tick, and `cmd_drones` is only
 * patched when a denormalised pill changes. Clients read liveness from
 * {@link listMyDroneLiveness}.
 *
 * @license GPL-3.0-only
 */

import { query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";

/** Record a heartbeat for `droneId` at `now`. */
export async function recordLiveness(
  ctx: MutationCtx,
  droneId: Id<"cmd_drones">,
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("cmd_droneLiveness")
    .withIndex("by_droneId", (q) => q.eq("droneId", droneId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { lastSeen: now });
  } else {
    await ctx.db.insert("cmd_droneLiveness", { droneId, lastSeen: now });
  }
}

/**
 * The drone's last heartbeat time. A drone that has not sent a heartbeat
 * since the liveness table existed falls back to the time its row recorded.
 */
export async function readLastSeen(
  ctx: QueryCtx,
  drone: Doc<"cmd_drones">,
): Promise<number | undefined> {
  const row = await ctx.db
    .query("cmd_droneLiveness")
    .withIndex("by_droneId", (q) => q.eq("droneId", drone._id))
    .first();
  return row?.lastSeen ?? drone.lastSeen;
}

/** Delete the liveness row of a drone that is being removed. */
export async function deleteLiveness(
  ctx: MutationCtx,
  droneId: Id<"cmd_drones">,
): Promise<void> {
  const rows = await ctx.db
    .query("cmd_droneLiveness")
    .withIndex("by_droneId", (q) => q.eq("droneId", droneId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
}

/**
 * Last heartbeat time of every drone paired to the caller. The only query a
 * fleet view needs to re-run on a heartbeat; it returns ids and times only.
 * `lastSeen` is null for a drone that has never been seen.
 */
export const listMyDroneLiveness = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const drones = await ctx.db
      .query("cmd_drones")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    return await Promise.all(
      drones.map(async (drone) => ({
        droneId: drone._id,
        deviceId: drone.deviceId,
        lastSeen: (await readLastSeen(ctx, drone)) ?? null,
      })),
    );
  },
});
