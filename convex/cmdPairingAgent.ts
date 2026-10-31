/**
 * @module cmdPairingAgent
 * @description Internal, agent-facing half of pairing: the `/pairing/register`
 * route's registration mutation and the broker auth-entry listing behind
 * `/admin/mqtt-auth-entries`. Neither is reachable from a browser client.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";
import {
  CODE_TTL_MS,
  MAX_DEVICE_ID_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_API_KEY_LENGTH,
  MAX_MQTT_AUTH_ENTRIES,
  normalizePairingCode,
  requireBoundedString,
  optionalBoundedString,
} from "./lib/pairingCodes";
import {
  REGISTER_POLICY,
  chargeAttempt,
  rateLimitedResult,
} from "./lib/rateLimit";
import { agentKeyMatches } from "./lib/credentials";

/**
 * Called by the `/pairing/register` HTTP route when an agent beacons its
 * pairing code. Handles upsert and auto-matching with pre-generated codes.
 *
 * INTERNAL. As a public mutation any browser could write an attacker-chosen
 * `apiKey` keyed by any `deviceId`, and could drive the pre-generated
 * auto-match branch — which inserts a `cmd_drones` row into the code
 * generator's fleet — as fast as it could guess codes.
 *
 * `clientKey` is a salted digest of the source address, stamped by the route
 * (never by the caller) and used only as a rate-limit bucket. It bounds the one
 * axis a code-guessing attack can travel: a second attempt reusing a device id
 * is refused by the binding below, so an attacker must vary the device id, and
 * only the source address stays constant.
 */
export const registerAgent = internalMutation({
  args: {
    clientKey: v.string(),
    deviceId: v.string(),
    pairingCode: v.string(),
    apiKey: v.string(),
    name: v.optional(v.string()),
    version: v.optional(v.string()),
    board: v.optional(v.string()),
    tier: v.optional(v.number()),
    os: v.optional(v.string()),
    mdnsHost: v.optional(v.string()),
    localIp: v.optional(v.string()),
    // Agent-authoritative pairing-code expiry (epoch seconds). Mirrors
    // the timer the agent's local wizard is showing the operator so
    // the cloud-side UI countdown matches the physical device.
    pairingCodeExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const deviceId = requireBoundedString(
      args.deviceId,
      "deviceId",
      MAX_DEVICE_ID_LENGTH,
    );
    const pairingCode = normalizePairingCode(args.pairingCode);
    const name = optionalBoundedString(args.name, "name", MAX_LABEL_LENGTH);
    const version = optionalBoundedString(
      args.version,
      "version",
      MAX_LABEL_LENGTH,
    );
    const board = optionalBoundedString(args.board, "board", MAX_LABEL_LENGTH);
    const os = optionalBoundedString(args.os, "os", MAX_LABEL_LENGTH);
    // Required, not optional. A blank key persisted `apiKey: ""`, which the
    // binding below cannot anchor to and which `agentKeyMatches` correctly
    // refuses to authenticate — a row that can never be authenticated is worse
    // than no row.
    const apiKey = requireBoundedString(args.apiKey, "apiKey", MAX_API_KEY_LENGTH);
    const mdnsHost = optionalBoundedString(
      args.mdnsHost,
      "mdnsHost",
      MAX_LABEL_LENGTH,
    );
    const localIp = optionalBoundedString(args.localIp, "localIp", MAX_LABEL_LENGTH);
    const clientBucket = `register:${requireBoundedString(
      args.clientKey,
      "clientKey",
      MAX_LABEL_LENGTH,
    )}`;
    if (
      args.tier !== undefined &&
      (!Number.isInteger(args.tier) || args.tier < 0 || args.tier > 10)
    ) {
      throw new Error("tier out of range");
    }
    // Validate the agent-side expiry. Reject negatives or absurd values
    // so a malformed beacon can never poison the row. Epoch seconds
    // beyond year 2100 are obvious noise.
    let pairingCodeExpiresAt: number | undefined = args.pairingCodeExpiresAt;
    if (pairingCodeExpiresAt !== undefined) {
      if (
        !Number.isFinite(pairingCodeExpiresAt) ||
        pairingCodeExpiresAt < 0 ||
        pairingCodeExpiresAt > 4_102_444_800
      ) {
        pairingCodeExpiresAt = undefined;
      }
    }

    // Paired-device credential binding. Once a device holds a cloud row with a
    // key, only the holder of that key may re-register it. Without this a
    // beacon from anyone could rotate a live drone's cloud credential to a
    // value they chose, and every subsequent heartbeat and relay command would
    // authenticate the attacker instead of the aircraft.
    const droneRow = await ctx.db
      .query("cmd_drones")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();
    if (droneRow?.apiKey && !agentKeyMatches(droneRow.apiKey, apiKey)) {
      return { error: "device_registration_conflict" };
    }

    // Re-register the same device without letting a mismatched public request
    // delete an active pending pairing window.
    const existing = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();
    if (existing) {
      if (existing.claimedBy) {
        // Surface the owner so the agent's beacon-claim handler can
        // record the real claimant (signed-in user id, or "browser:<session>"
        // for anon claims) instead of defaulting to the literal "cloud".
        return { alreadyClaimed: true, userId: existing.claimedBy };
      }
      // A beacon re-presenting the key it registered with is free — that is the
      // steady state and it must never ladder toward a lockout. A different key
      // on a LIVE pending row is refused: otherwise anyone who learned the
      // device id could swap in their own key and code and claim the device.
      // Once the row's window lapses (the old key stopped beaconing), a new key
      // may take it over, charged as a novel registration.
      if (!agentKeyMatches(existing.apiKey, apiKey)) {
        const verdict = await chargeAttempt(ctx, clientBucket, REGISTER_POLICY, now);
        if (!verdict.ok) return rateLimitedResult(verdict.retryAfterMs);
        if (existing.expiresAt >= now) {
          return { error: "device_registration_conflict" };
        }
      }
      await ctx.db.patch(existing._id, {
        pairingCode,
        agentName: name,
        agentVersion: version,
        board,
        tier: args.tier,
        os,
        apiKey,
        mdnsHost,
        localIp,
        expiresAt: now + CODE_TTL_MS,
        ...(pairingCodeExpiresAt !== undefined ? { pairingCodeExpiresAt } : {}),
      });
      return { registered: true };
    }

    // First contact for this device id, from this source address. The code is
    // bucketed too: the auto-match branch below turns a guessed pre-generated
    // code into a device in someone's fleet, so each code gets a bounded
    // number of first-contact tries however many addresses present it.
    const clientVerdict = await chargeAttempt(ctx, clientBucket, REGISTER_POLICY, now);
    if (!clientVerdict.ok) return rateLimitedResult(clientVerdict.retryAfterMs);
    const codeVerdict = await chargeAttempt(
      ctx,
      `register:code:${pairingCode}`,
      REGISTER_POLICY,
      now,
    );
    if (!codeVerdict.ok) return rateLimitedResult(codeVerdict.retryAfterMs);

    // Check if a pre-generated code matches (zero-touch flow)
    const preGenerated = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_pairingCode", (q) =>
        q.eq("pairingCode", pairingCode)
      )
      .first();
    if (preGenerated && preGenerated.createdBy && !preGenerated.claimedBy) {
      if (preGenerated.expiresAt < now) {
        await ctx.db.delete(preGenerated._id);
        return { error: "pairing_code_expired" };
      }
      // Auto-match: pre-generated code found, auto-claim it
      await ctx.db.patch(preGenerated._id, {
        deviceId,
        agentName: name,
        agentVersion: version,
        board,
        tier: args.tier,
        os,
        apiKey,
        mdnsHost,
        localIp,
        claimedBy: preGenerated.createdBy!,
        claimedAt: now,
      });
      // Upsert drone record
      const ownerId = preGenerated.createdBy!;
      const existingDrone = await ctx.db
        .query("cmd_drones")
        .withIndex("by_userId", (q) => q.eq("userId", ownerId))
        .filter((q) => q.eq(q.field("deviceId"), deviceId))
        .first();

      if (existingDrone) {
        await ctx.db.patch(existingDrone._id, {
          apiKey,
          agentVersion: version,
          board,
          tier: args.tier,
          os,
          mdnsHost,
          lastIp: localIp,
          lastSeen: now,
          pairedAt: now,
        });
      } else {
        await ctx.db.insert("cmd_drones", {
          userId: ownerId,
          deviceId,
          name: name || `Drone ${pairingCode}`,
          apiKey,
          agentVersion: version,
          board,
          tier: args.tier,
          os,
          mdnsHost,
          lastIp: localIp,
          lastSeen: now,
          fcConnected: false,
          pairedAt: now,
        });
      }
      return { autoMatched: true, userId: ownerId };
    }

    // Insert new pairing request
    await ctx.db.insert("cmd_pairingRequests", {
      deviceId,
      pairingCode,
      agentName: name,
      agentVersion: version,
      board,
      tier: args.tier,
      os,
      apiKey,
      mdnsHost,
      localIp,
      expiresAt: now + CODE_TTL_MS,
      ...(pairingCodeExpiresAt !== undefined ? { pairingCodeExpiresAt } : {}),
    });

    return { registered: true };
  },
});

/**
 * List paired drones suitable for mosquitto passwd generation. Returns
 * { username, apiKey } pairs where username == deviceId. Only includes
 * drones with a non-empty apiKey (unpaired skeleton rows are skipped).
 *
 * Internal — gated by the /admin/mqtt-auth-entries httpAction which
 * checks the MQTT_AUTH_RELAY_SECRET bearer token. NEVER expose this
 * directly via a public query.
 *
 * BOUNDED. This is the highest-value read in either tree — every device's
 * plaintext key plus every live grant's broker line — and it ran as an
 * unbounded double `.collect()`. `truncated` is reported rather than silently
 * capped so a fleet that outgrows the bound produces a visible signal instead
 * of a broker file that quietly stops authenticating the tail of the estate.
 */
export const listMqttAuthEntries = internalQuery({
  args: {},
  handler: async (ctx) => {
    const drones = await ctx.db
      .query("cmd_drones")
      .take(MAX_MQTT_AUTH_ENTRIES + 1);
    const truncatedDrones = drones.length > MAX_MQTT_AUTH_ENTRIES;
    const entries = drones
      .slice(0, MAX_MQTT_AUTH_ENTRIES)
      .filter((d) => typeof d.apiKey === "string" && d.apiKey.length > 0)
      .map((d) => ({ username: d.deviceId, apiKey: d.apiKey }));

    // Operator write grants, alongside the device entries.
    //
    // The shared `gcs-viewer` principal is read-only by design ("do NOT grant
    // write access here" in the generated ACL), so a browser has never been
    // able to publish a command -- flight frames and video signalling were
    // discarded by the broker. These grants are what gives an operator write
    // access, scoped to the devices they owned when the grant was minted.
    //
    // `passwdEntry` is already a broker password line (PBKDF2 verifier, never
    // the secret), so the regeneration script appends it verbatim instead of
    // re-hashing. Expired and revoked grants are dropped here rather than on
    // the host: the broker file should never contain a credential that is no
    // longer valid, whatever the sync cadence happens to be. Walked by
    // `by_expiresAt` from now forward so the read touches only live grants.
    const now = Date.now();
    const liveGrants = await ctx.db
      .query("cmd_mqttControlGrants")
      .withIndex("by_expiresAt", (q) => q.gt("expiresAt", now))
      .take(MAX_MQTT_AUTH_ENTRIES + 1);
    const truncatedGrants = liveGrants.length > MAX_MQTT_AUTH_ENTRIES;
    const grants = liveGrants
      .slice(0, MAX_MQTT_AUTH_ENTRIES)
      .filter((g) => !g.revokedAt)
      .map((g) => ({
        principal: g.principal,
        passwdEntry: g.passwdEntry,
        deviceIds: g.deviceIds,
      }));

    // `entries` keeps its original shape so an older copy of the script that
    // does not know about grants still regenerates devices correctly.
    return { entries, grants, truncated: truncatedDrones || truncatedGrants };
  },
});
