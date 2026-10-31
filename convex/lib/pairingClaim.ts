/**
 * @module convex/lib/pairingClaim
 * @description Handler bodies for the public pairing-code claims: the anonymous
 * browser-session claim and the signed-in claim.
 *
 * @license GPL-3.0-only
 */

import type { MutationCtx } from "../_generated/server";
import {
  MAX_SECRET_LENGTH,
  CLAIM_GLOBAL_BUCKET,
  BROWSER_SESSION_TTL_MS,
  normalizePairingCode,
  requireBoundedString,
} from "./pairingCodes";
import {
  CLAIM_GLOBAL_POLICY,
  CLAIM_POLICY,
  chargeAttempt,
  checkBucket,
  clearAttempts,
  rateLimitedResult,
  sha256Hex,
} from "./rateLimit";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Resolve a presented browser-session secret hash to its owner marker,
 * touching `lastSeenAt` so an active browser is never swept. Returns null when
 * the secret is unknown or the session has gone stale.
 */
export async function resolveBrowserOwner(
  ctx: MutationCtx,
  secretHash: string,
  now: number,
): Promise<string | null> {
  const row = await ctx.db
    .query("cmd_browserSessions")
    .withIndex("by_secretHash", (q) => q.eq("secretHash", secretHash))
    .first();
  if (!row) return null;
  if (now - row.lastSeenAt > BROWSER_SESSION_TTL_MS) return null;
  await ctx.db.patch(row._id, { lastSeenAt: now });
  return `browser:${row._id}`;
}

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
export async function claimForBrowser(
  ctx: MutationCtx,
  code: string,
  browserSessionSecret: string,
) {
  const now = Date.now();
  const pairingCode = normalizePairingCode(code);
  const secret = requireBoundedString(
    browserSessionSecret,
    "browserSessionSecret",
    MAX_SECRET_LENGTH,
  );
  const secretHash = await sha256Hex(secret);

  // Two buckets. Per-session bounds one browser guessing codes: consumed
  // before any lookup and cleared on its own success. The global bucket is
  // the backstop against the same guess spread across many sessions: checked
  // on every claim, charged only by a failed code, and never reset by any
  // one caller's success.
  const sessionBucket = `claim:session:${secretHash}`;
  const sessionVerdict = await chargeAttempt(ctx, sessionBucket, CLAIM_POLICY, now);
  if (!sessionVerdict.ok) return rateLimitedResult(sessionVerdict.retryAfterMs);
  const globalVerdict = await checkBucket(ctx, CLAIM_GLOBAL_BUCKET, CLAIM_GLOBAL_POLICY, now);
  if (!globalVerdict.ok) return rateLimitedResult(globalVerdict.retryAfterMs);

  const browserMarker = await resolveBrowserOwner(ctx, secretHash, now);
  if (!browserMarker) return { error: "invalid_browser_session" as const };

  const request = await ctx.db
    .query("cmd_pairingRequests")
    .withIndex("by_pairingCode", (q) => q.eq("pairingCode", pairingCode))
    .first();

  if (!request) {
    await chargeAttempt(ctx, CLAIM_GLOBAL_BUCKET, CLAIM_GLOBAL_POLICY, now);
    return { error: "invalid_pairing_code" as const };
  }
  if (request.expiresAt < now) {
    await ctx.db.delete(request._id);
    await chargeAttempt(ctx, CLAIM_GLOBAL_BUCKET, CLAIM_GLOBAL_POLICY, now);
    return { error: "pairing_code_expired" as const };
  }
  if (request.claimedBy && request.claimedBy !== browserMarker) {
    await chargeAttempt(ctx, CLAIM_GLOBAL_BUCKET, CLAIM_GLOBAL_POLICY, now);
    return { error: "code_already_claimed" as const };
  }

  // Anon-paired drones still need a cmd_drones row so the agent's
  // /agent/status heartbeat can validate its apiKey. Without this the
  // heartbeat handler 401s every 5 s and cloud relay never delivers
  // telemetry — fine for LAN-direct on HTTP origins but a dead end on
  // HTTPS (mixed-content blocks the LAN path). The browser:<sessionId>
  // marker stays out of the way of real Convex auth user ids; the
  // listMyDrones query filters on getAuthUserId() which never returns
  // a "browser:" prefix, so signed-in users don't see anon drones.
  const deviceId = request.deviceId || `device-${pairingCode}`;
  const existingDrone = await ctx.db
    .query("cmd_drones")
    .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
    .first();

  // Single-owner guard: an anon claim may re-pair a device this same
  // session already owns, but must not reassign one owned by another
  // account or a different session. Checked before the claim patch so a
  // rejected attempt never consumes the code. A genuine owner who lost
  // their session recovers by unpairing on the device and re-pairing.
  if (existingDrone && existingDrone.userId !== browserMarker) {
    return { error: "device_owned_by_other" as const };
  }

  await ctx.db.patch(request._id, {
    claimedBy: browserMarker,
    claimedAt: now,
  });

  if (existingDrone) {
    await ctx.db.patch(existingDrone._id, {
      userId: browserMarker,
      apiKey: request.apiKey || existingDrone.apiKey,
      agentVersion: request.agentVersion ?? existingDrone.agentVersion,
      board: request.board ?? existingDrone.board,
      tier: request.tier ?? existingDrone.tier,
      os: request.os ?? existingDrone.os,
      mdnsHost: request.mdnsHost ?? existingDrone.mdnsHost,
      lastIp: request.localIp ?? existingDrone.lastIp,
      lastSeen: now,
      pairedAt: now,
    });
  } else {
    await ctx.db.insert("cmd_drones", {
      userId: browserMarker,
      deviceId,
      name: request.agentName || `Drone ${pairingCode}`,
      apiKey: request.apiKey || "",
      agentVersion: request.agentVersion,
      board: request.board,
      tier: request.tier,
      os: request.os,
      mdnsHost: request.mdnsHost,
      lastIp: request.localIp,
      lastSeen: now,
      fcConnected: false,
      pairedAt: now,
    });
  }

  await clearAttempts(ctx, sessionBucket);

  // NO apiKey. The browser resolves the agent's address here and takes the
  // durable credential from the agent itself over the LAN pair, which is the
  // only path where the key is handed to a party that proved LAN reach.
  return {
    error: null,
    deviceId,
    name: request.agentName || `Drone ${pairingCode}`,
    mdnsHost: request.mdnsHost,
    localIp: request.localIp,
    board: request.board,
    agentVersion: request.agentVersion,
  };
}

/** A signed-in user claims a pairing code shown on the agent terminal. */
export async function claimForUser(ctx: MutationCtx, code: string) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const now = Date.now();
  const pairingCode = normalizePairingCode(code);

  // Signed in, but still a bearer-code guess: bucket by the account so one
  // compromised session cannot walk the code space.
  const bucket = `claim:user:${userId}`;
  const verdict = await chargeAttempt(ctx, bucket, CLAIM_POLICY, now);
  if (!verdict.ok) return rateLimitedResult(verdict.retryAfterMs);

  const request = await ctx.db
    .query("cmd_pairingRequests")
    .withIndex("by_pairingCode", (q) =>
      q.eq("pairingCode", pairingCode)
    )
    .first();

  if (!request) return { error: "invalid_pairing_code" as const };
  if (request.expiresAt < now) {
    await ctx.db.delete(request._id);
    return { error: "pairing_code_expired" as const };
  }
  if (request.claimedBy) return { error: "code_already_claimed" as const };

  // Single-owner guard: refuse to claim a device another account already
  // owns instead of silently creating a second owner row (with its own
  // API key) for the same hardware. The legitimate re-pair-to-a-new-
  // account path is for the current owner to release it first
  // (wipePairStateForOwnedDevice). Checked before the claim patch so a
  // rejected attempt never marks the code consumed.
  const deviceId = request.deviceId || `device-${pairingCode}`;
  const deviceRows = await ctx.db
    .query("cmd_drones")
    .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
    .collect();
  if (deviceRows.some((d) => d.userId !== userId)) {
    return { error: "device_owned_by_other" as const };
  }

  // Mark as claimed
  await ctx.db.patch(request._id, {
    claimedBy: userId,
    claimedAt: now,
  });

  // Upsert: update existing drone record if same user + device
  const existingDrone = await ctx.db
    .query("cmd_drones")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .filter((q) => q.eq(q.field("deviceId"), deviceId))
    .first();

  let droneId;
  if (existingDrone) {
    await ctx.db.patch(existingDrone._id, {
      apiKey: request.apiKey || "",
      agentVersion: request.agentVersion,
      board: request.board,
      tier: request.tier,
      os: request.os,
      mdnsHost: request.mdnsHost,
      lastIp: request.localIp,
      lastSeen: now,
      pairedAt: now,
    });
    droneId = existingDrone._id;
  } else {
    droneId = await ctx.db.insert("cmd_drones", {
      userId,
      deviceId,
      name: request.agentName || `Drone ${pairingCode}`,
      apiKey: request.apiKey || "",
      agentVersion: request.agentVersion,
      board: request.board,
      tier: request.tier,
      os: request.os,
      mdnsHost: request.mdnsHost,
      lastIp: request.localIp,
      lastSeen: now,
      fcConnected: false,
      pairedAt: now,
    });
  }

  await clearAttempts(ctx, bucket);

  // The apiKey goes to the authenticated owner of the device that just
  // claimed it — the one caller entitled to it.
  return {
    error: null,
    droneId,
    apiKey: request.apiKey || "",
    mdnsHost: request.mdnsHost,
    localIp: request.localIp,
    deviceId,
    name: existingDrone?.name || request.agentName,
  };
}
