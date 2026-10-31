/**
 * @module cmdDroneStatus
 * @description Convex functions for drone cloud status relay.
 * Agent pushes full system status via HTTP action. GCS reads via reactive query.
 * @license GPL-3.0-only
 */

import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireOwnedDroneByDeviceId } from "./cmdDroneAccess";
import type { Doc } from "./_generated/dataModel";
import type { WithoutSystemFields } from "convex/server";
import { readLastSeen, recordLiveness } from "./cmdDroneLiveness";
import { attachedDisplayType, manualMavlinkWsUrl } from "./lib/fleetCardFields";
import { pushStatusArgs } from "./lib/pushStatusArgs";

/**
 * Push status from agent (called via HTTP action, no auth — validated by API key match).
 * Upserts by deviceId.
 */
export const pushStatus = internalMutation({
  args: pushStatusArgs,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("cmd_droneStatus")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();

    const now = Date.now();

    // EVERY declared column is written on every tick, present-with-undefined
    // for the ones the agent did not send.
    //
    // Convex drops `undefined`-valued keys when serializing mutation
    // ARGUMENTS, so a field the agent omits is simply absent from `args` —
    // `{...args}` does not carry the key and `db.patch` leaves the previous
    // value in place forever. Radio, linked peers, video streams and CAN all
    // decayed that way: a remote operator saw a dead link as healthy, with a
    // plausible RSSI and a fresh `updatedAt`. The `localSurfaceFields` block
    // below was the proof — it names its keys explicitly, so they ARE present
    // with value `undefined`, which Convex encodes as `{$undefined:null}` and
    // which DELETES the column. The LCD block cleared correctly; nothing else
    // did.
    //
    // Building the patch from `pushStatusArgs`' key list makes that the rule
    // rather than the exception, and it cannot drift: a new arg is covered the
    // moment it is declared.
    type StatusRow = WithoutSystemFields<Doc<"cmd_droneStatus">>;
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(pushStatusArgs)) {
      patch[key] = (args as Record<string, unknown>)[key];
    }
    patch.updatedAt = now;
    const row = patch as unknown as StatusRow;

    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("cmd_droneStatus", row);
    }

    // Liveness goes to its own row every tick; the `cmd_drones` row is only
    // patched when a denormalised fleet-card value actually changes, so the
    // fleet list does not re-run for every subscriber on every heartbeat.
    const drone = await ctx.db
      .query("cmd_drones")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (drone) {
      await recordLiveness(ctx, drone._id, now);
      // Every denormalized fleet-card column is derived from THIS payload,
      // exactly as the status row above is: a pill whose source vanished (LCD
      // unplugged, LAN URL withdrawn, camera gone) clears instead of rendering
      // the last value forever.
      const fleetCard = {
        // Every heartbeat carries the running agent's version; the pairing-time
        // value would otherwise stand for the life of the pairing.
        agentVersion: args.version,
        fcConnected: args.fcConnected,
        lastIp: args.lastIp,
        mdnsHost: args.mdnsHost,
        runtimeMode: args.runtimeMode,
        attachedDisplayType: attachedDisplayType(args.peripherals),
        profileSource: args.profileSource,
        profile: args.profile,
        role: args.role,
        manualMavlinkWsUrl: manualMavlinkWsUrl(args.manualConnectionUrls),
        peerDeviceId: args.peerDeviceId,
        peerRssiDbm: args.peerRssiDbm,
        cameraState: args.cameraState,
        fcLinkHint: args.fcLinkHint,
        cloudPosture: args.cloudPosture,
      } satisfies Partial<Doc<"cmd_drones">>;
      const current = drone as Record<string, unknown>;
      const changed = Object.entries(fleetCard).some(([key, value]) => current[key] !== value);
      if (changed) {
        await ctx.db.patch(drone._id, fleetCard);
      }
    }

    return { ok: true };
  },
});

/**
 * Get cloud status for a specific drone.
 */
export const getCloudStatus = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    await requireOwnedDroneByDeviceId(ctx, deviceId);
    return await ctx.db
      .query("cmd_droneStatus")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();
  },
});

/**
 * List display-safe cloud status rows for every drone paired to the
 * authenticated user. Pair keys are intentionally not returned.
 */
export const listMyCloudStatuses = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const drones = await ctx.db
      .query("cmd_drones")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    return await Promise.all(
      drones.map(async (drone) => {
        const status = await ctx.db
          .query("cmd_droneStatus")
          .withIndex("by_deviceId", (q) => q.eq("deviceId", drone.deviceId))
          .first();

        return {
          drone: {
            _id: drone._id,
            userId: drone.userId,
            deviceId: drone.deviceId,
            name: drone.name,
            agentVersion: drone.agentVersion,
            board: drone.board,
            tier: drone.tier,
            os: drone.os,
            mdnsHost: drone.mdnsHost,
            lastIp: drone.lastIp,
            lastSeen: await readLastSeen(ctx, drone),
            fcConnected: drone.fcConnected,
            pairedAt: drone.pairedAt,
          },
          status,
        };
      }),
    );
  },
});
