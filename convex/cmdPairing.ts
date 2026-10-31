/**
 * @module cmdPairing
 * @description Convex functions for the ADOS drone pairing system.
 * Supports two flows:
 * 1. Agent-initiated: agent generates code → user enters code in GCS
 * 2. User-initiated: user pre-generates code → agent uses it during install
 *
 * EXPOSURE RULES for this file and its internal halves (`cmdPairingAgent`,
 * `cmdPairingCleanup`), because every function here sits on the
 * boundary between an unauthenticated caller and an agent credential:
 *
 *   - `registerAgent` is INTERNAL. It is the agent-facing half of the flow,
 *     reached only through the `/pairing/register` route in `http.ts`, which
 *     supplies the source-address bucket key. As a public mutation it let any
 *     browser holding a `ConvexReactClient` write an attacker-chosen `apiKey`
 *     keyed by `deviceId`. The agent learns it was claimed from that route's
 *     answer, so there is no separate claim-status read.
 *   - `claimPairingCodeAnon` never returns an agent API key. The browser gets
 *     the agent's network address and pairs LAN-direct, taking the key from the
 *     agent itself over `/api/pairing/claim`. A six-character code is a weak
 *     enough bearer that it must not be exchangeable for a credential.
 *   - The anonymous owner is DERIVED from a server-minted browser session, not
 *     read out of an argument. See `issueBrowserSession`.
 *   - Every anonymous entry point consumes a rate-limit attempt before it does
 *     any work. See `convex/lib/rateLimit.ts`.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  CODE_TTL_MS,
  MAX_PENDING_CODES,
  normalizePairingCode,
  generatePairingCode,
} from "./lib/pairingCodes";
import {
  SESSION_MINT_POLICY,
  mintSecret,
  noteAttempt,
  sha256Hex,
} from "./lib/rateLimit";
import { getAuthUserId } from "@convex-dev/auth/server";
import { claimForBrowser, claimForUser } from "./lib/pairingClaim";

/**
 * Mint an anonymous browser session and return its secret exactly once.
 *
 * This exists because the anonymous pair path used to take a `browserUserId`
 * straight from the caller and write it into `cmd_drones.userId` as the owner.
 * A caller can choose any argument value, so knowing another browser's UUID was
 * enough to assert ownership of that browser's nodes and to consume its pending
 * pairing claims. Ownership is now derived from a secret this server generated:
 * the table stores only the SHA-256, the plaintext lives in the mint response
 * and the operator's browser, and the owner marker is `browser:<row id>` —
 * a value the caller never supplies.
 *
 * Same posture as `cmdMqttControlGrants.mint`: verifier-only storage, plaintext
 * exactly once. Anonymous by design (the whole point of the path is that no
 * account is required), so it is rate limited rather than authenticated.
 */
export const issueBrowserSession = mutation({
  args: {},
  handler: async (ctx): Promise<{ browserSessionSecret: string }> => {
    const now = Date.now();
    // No caller identity to bucket by. A blocking global limit here would let
    // one script stop every new browser from pairing, so the global count is
    // an alarm that logs, never a gate. Unused sessions are swept by
    // `cleanExpiredSecurityState`.
    await noteAttempt(ctx, "session:mint:global", SESSION_MINT_POLICY, now);

    const secret = mintSecret();
    await ctx.db.insert("cmd_browserSessions", {
      secretHash: await sha256Hex(secret),
      createdAt: now,
      lastSeenAt: now,
    });
    return { browserSessionSecret: secret };
  },
});

/** Anonymous code-pair: the browser proves which anonymous session it is with
 *  a secret this server minted (`issueBrowserSession`), and gets back the
 *  agent's ADDRESS — never its API key. The browser then pairs LAN-direct
 *  against the agent's own `/api/pairing/claim`, which is where the durable
 *  key comes from, exactly as the hostname-typed path already does.
 *
 *  Trade-off vs the signed-in `claimPairingCode`: this path writes a
 *  `cmd_drones` row owned by `browser:<session>`, not by a Convex account. The
 *  drone is LAN-only for this browser until the operator signs in and migrates
 *  (out of scope today). In return, the "no account required" promise extends
 *  to the short-code path, not just the hostname path.
 */
export const claimPairingCodeAnon = mutation({
  args: { code: v.string(), browserSessionSecret: v.string() },
  handler: async (ctx, { code, browserSessionSecret }) =>
    claimForBrowser(ctx, code, browserSessionSecret),
});

/** User claims a pairing code (enters code displayed on agent terminal). */
export const claimPairingCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => claimForUser(ctx, code),
});

/** User pre-generates a pairing code (for zero-touch install). */
export const preGenerateCode = mutation({
  args: { code: v.optional(v.string()) },
  handler: async (ctx, { code }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    let pairingCode = code ? normalizePairingCode(code) : "";
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!pairingCode) pairingCode = generatePairingCode();
      const existing = await ctx.db
        .query("cmd_pairingRequests")
        .withIndex("by_pairingCode", (q) => q.eq("pairingCode", pairingCode))
        .first();
      if (!existing) break;
      if (existing.expiresAt < Date.now() && !existing.claimedBy) {
        await ctx.db.delete(existing._id);
        break;
      }
      if (code) throw new Error("Pairing code already exists");
      pairingCode = "";
    }

    if (!pairingCode) {
      throw new Error("Could not allocate pairing code");
    }

    const requestId = await ctx.db.insert("cmd_pairingRequests", {
      pairingCode,
      expiresAt: Date.now() + CODE_TTL_MS,
      createdBy: userId,
    });

    return { requestId, code: pairingCode };
  },
});

/** User sees their pre-generated (unclaimed) codes. */
export const getMyPendingCodes = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
      .filter((q) => q.eq(q.field("claimedBy"), undefined))
      .take(MAX_PENDING_CODES);
    // Projected, not the raw row: a pairing request carries the agent's apiKey
    // once a device has registered against it, and a pending-codes list has no
    // business carrying a credential.
    return rows.map((r) => ({
      _id: r._id,
      _creationTime: r._creationTime,
      pairingCode: r.pairingCode,
      expiresAt: r.expiresAt,
      pairingCodeExpiresAt: r.pairingCodeExpiresAt,
      deviceId: r.deviceId,
      agentName: r.agentName,
    }));
  },
});

/**
 * The device that registered against one of the caller's pre-generated codes,
 * or null while the code is still unclaimed. Scoped to the code's creator, so a
 * request id tells nobody else anything.
 */
export const getPreGeneratedClaim = query({
  args: { requestId: v.id("cmd_pairingRequests") },
  handler: async (ctx, { requestId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const request = await ctx.db.get(requestId);
    if (!request || request.createdBy !== userId) return null;
    if (!request.claimedBy || !request.deviceId) return null;
    return { deviceId: request.deviceId };
  },
});

/**
 * Operator-driven recovery: wipe pair state for a single device the
 * signed-in user owns (or no owner at all, see below). Delegates the
 * actual delete sweep to the internal mutation so the wipe surface
 * stays one code path.
 *
 * Ownership rules: if a cmd_drones row exists for this deviceId, the
 * caller must be its owner. If no row exists (the device was paired
 * to a different account, the row never existed, or the pairing
 * request is stale and orphan), the wipe is ALSO allowed. This lets
 * the operator clean up local-only broken state where the cloud row
 * was already gone but the pairing request lingered, or where the
 * device was previously claimed by another browser the operator no
 * longer controls.
 */
export const wipePairStateForOwnedDevice = mutation({
  args: { deviceId: v.string() },
  // Explicit handler return type breaks the self-referential typing
  // loop introduced by the `internal.cmdPairingCleanup.wipeByDeviceIds` call
  // below — Convex's generated `internal` API depends on the type of
  // every export in this file, including ours.
  handler: async (
    ctx,
    { deviceId },
  ): Promise<{
    removedRequests: number;
    removedDrones: number;
    removedStatus: number;
    removedCommands: number;
    removedPluginRecords: number;
    removedLogWindows: number;
    truncated: boolean;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existingDrone = await ctx.db
      .query("cmd_drones")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();
    if (existingDrone && existingDrone.userId !== userId) {
      throw new Error("Device is owned by a different account");
    }

    return await ctx.runMutation(internal.cmdPairingCleanup.wipeByDeviceIds, {
      deviceIds: [deviceId],
    });
  },
});
