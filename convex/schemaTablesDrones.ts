/**
 * @module schemaTablesDrones
 * @description Pairing, liveness, cloud-status and command tables.
 *
 * Shared by every deployment; composed by `schemaTables.ts`.
 *
 * @license GPL-3.0-only
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";
import { droneStatusCoreFields } from "./schemaDroneStatusCore";
import { droneStatusSurfaceFields } from "./schemaDroneStatusSurfaces";

export const droneTables = {
  // ── ADOS Pairing tables (cmd_ prefix) ──────────────────────

  cmd_drones: defineTable({
    userId: v.string(),
    deviceId: v.string(),
    name: v.string(),
    // An empty string means "paired, but no agent key yet" -- the browser can
    // claim a pairing code before the agent has connected, and the field is
    // required so there is no `undefined` to store. Such a row must NEVER
    // authenticate: compare with `agentKeyMatches` (convex/lib/credentials.ts),
    // which refuses a blank on either side. A plain `stored !== presented`
    // check authenticates any caller who sends an empty key.
    apiKey: v.string(),
    agentVersion: v.optional(v.string()),
    board: v.optional(v.string()),
    tier: v.optional(v.number()),
    os: v.optional(v.string()),
    mdnsHost: v.optional(v.string()),
    lastIp: v.optional(v.string()),
    lastSeen: v.optional(v.number()),
    fcConnected: v.optional(v.boolean()),
    // Backend variant. Synced from cmd_droneStatus heartbeats so the
    // fleet view can show a "Lite" pill without an extra query.
    runtimeMode: v.optional(v.string()),
    // Attached panel type derived from cmd_droneStatus.peripherals[].
    // Drives the "LCD" pill on the fleet drone card without an extra
    // query. One of "spi-lcd", "hdmi", "none", or undefined.
    attachedDisplayType: v.optional(v.string()),
    // How the agent landed on its current profile. Synced from
    // cmd_droneStatus heartbeats so the fleet card can render an
    // "auto" pill without an extra query. One of "detected",
    // "tiebreaker", "default", "override", "user", or undefined.
    profileSource: v.optional(v.string()),
    // Wire-contract node profile and role. Synced from cmd_droneStatus
    // heartbeats so listMyDrones consumers (fleet cards, node sidebar)
    // can render profile pills without joining the status row. Profile
    // is "drone" | "ground-station" | "workstation"; role applies
    // to ground stations only.
    profile: v.optional(v.string()),
    role: v.optional(v.string()),
    // Direct LAN MAVLink WebSocket URL the agent advertises in its
    // heartbeat's manualConnectionUrls block. Denormalized onto
    // cmd_drones so the fleet card can render a "Direct" pill (and
    // popover with the URL) without joining cmd_droneStatus on every
    // render. Null when the agent reports no LAN-routable URL.
    manualMavlinkWsUrl: v.optional(v.string()),
    // GPS-denied navigation quick-flag for fleet pills. Synced from
    // cmd_droneStatus.navigation when the agent reports an active
    // optical-flow or VIO estimator. Denormalized so the fleet card
    // can render a "GPS-denied" badge without joining cmd_droneStatus.
    navigationGpsDenied: v.optional(v.boolean()),
    // Inter-rig peer device-id quick-flag for fleet pills. Synced
    // from cmd_droneStatus.peerDeviceId so the fleet card renders a
    // "Peer" pill without joining cmd_droneStatus on every render.
    // Null / undefined when no peer beacon has decoded recently.
    peerDeviceId: v.optional(v.union(v.string(), v.null())),
    peerRssiDbm: v.optional(v.union(v.number(), v.null())),
    // Primary camera discovery state, denormalized from
    // cmd_droneStatus.cameraState so the fleet card can render a
    // "Camera Missing" pill without joining cmd_droneStatus.
    cameraState: v.optional(v.union(v.string(), v.null())),
    // FC-link diagnostic hint ("none" | "msp_detected" | "no_heartbeat"),
    // denormalized from cmd_droneStatus so the fleet card can render the
    // "FC: MSP" / "FC: no MAVLink" pill without joining cmd_droneStatus.
    fcLinkHint: v.optional(v.string()),
    // Cloud posture chosen on the agent: "local" | "cloud" | "self_hosted".
    // Synced from cmd_droneStatus heartbeats so the fleet card can render
    // a "Local-only" pill (and operators can tell intentional local-only
    // from a drone that simply dropped off the cloud relay) without
    // joining cmd_droneStatus on every render.
    cloudPosture: v.optional(v.string()),
    // List of plugin ids currently installed on this drone. Synced
    // from cmd_pluginInstalls so the drone-detail panel can resolve
    // plugin slot contributions (drone.detail.tab and friends)
    // without a separate per-drone query on every render.
    installedPluginIds: v.optional(v.array(v.string())),
    pairedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_deviceId", ["deviceId"]),

  // Heartbeat liveness, one row per drone. Written every agent heartbeat;
  // kept off `cmd_drones` so the fleet list only re-runs when a fleet-card
  // value changes (see cmdDroneLiveness.ts).
  cmd_droneLiveness: defineTable({
    droneId: v.id("cmd_drones"),
    lastSeen: v.number(),
  })
    .index("by_droneId", ["droneId"]),

  // ── Cloud relay tables (cmd_ prefix) ──────────────────────

  cmd_droneStatus: defineTable({
    ...droneStatusCoreFields,
    ...droneStatusSurfaceFields,
  })
    .index("by_deviceId", ["deviceId"]),

  cmd_droneCommands: defineTable({
    deviceId: v.string(),
    userId: v.string(),
    command: v.string(),
    args: v.optional(v.any()),
    // "pending"    — queued, not yet picked up by the agent.
    // "delivering" — claimed by an agent for execution; the claim carries a
    //                lease so a crashed/disconnected agent's claim expires
    //                and the row becomes claimable again (bounded by
    //                `attempts`). The terminal statuses are set on ack.
    // "completed" / "failed" — terminal.
    status: v.union(
      v.literal("pending"),
      v.literal("delivering"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    result: v.optional(v.object({
      success: v.boolean(),
      message: v.string(),
    })),
    data: v.optional(v.any()),
    createdAt: v.number(),
    // When the row was last claimed (status flipped to "delivering"). The
    // lease is `claimedAt + lease window`; a stale lease lets the next poll
    // reclaim the row so a crashed agent does not strand a command forever.
    claimedAt: v.optional(v.number()),
    // Delivery attempt count, incremented on each claim. Bounds re-execution
    // of a non-idempotent command when an ack never arrives.
    attempts: v.optional(v.number()),
    // End of the delivery window (server clock), set when the enqueue carried
    // a TTL. A row the agent has not taken by then is failed, never delivered.
    expiresAt: v.optional(v.number()),
    // When the agent's poll first took the row. Set means the node has it and
    // its ack is pending; absent means it is still only queued.
    deliveredAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_deviceId_status", ["deviceId", "status"])
    .index("by_deviceId_createdAt", ["deviceId", "createdAt"])
    // Retention sweep: range terminal rows by completion time so the cleanup
    // cron deletes old completed/failed rows with a bounded indexed scan
    // instead of a full-table walk.
    .index("by_status_completedAt", ["status", "completedAt"])
    // Stuck sweep: a non-terminal row ranged by AGE, so the expiry pass reads
    // only rows older than its cutoff. `by_status_completedAt` cannot serve
    // this -- a pending row has no completedAt.
    .index("by_status_createdAt", ["status", "createdAt"]),

  cmd_pairingRequests: defineTable({
    deviceId: v.optional(v.string()),
    pairingCode: v.string(),
    agentName: v.optional(v.string()),
    agentVersion: v.optional(v.string()),
    board: v.optional(v.string()),
    tier: v.optional(v.number()),
    os: v.optional(v.string()),
    apiKey: v.optional(v.string()),
    mdnsHost: v.optional(v.string()),
    localIp: v.optional(v.string()),
    expiresAt: v.number(),
    // Agent-authoritative pairing-code expiry (epoch seconds) lifted
    // from the beacon body. The server-side expiresAt above is the
    // cloud-relay TTL; this field mirrors what the agent's local
    // wizard is showing the operator so the GCS countdown matches the
    // physical device. Optional so legacy beacons keep registering.
    pairingCodeExpiresAt: v.optional(v.number()),
    createdBy: v.optional(v.string()),
    claimedBy: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
  })
    .index("by_pairingCode", ["pairingCode"])
    .index("by_deviceId", ["deviceId"])
    .index("by_createdBy", ["createdBy"])
    // Unclaimed rows by expiry: the expiry sweep ranges only the rows it may
    // delete, so kept (claimed) rows never fill its batch.
    .index("by_claimedBy_expiresAt", ["claimedBy", "expiresAt"]),

  // Attempt counters with escalating lockout, for every surface reachable
  // without a session: anonymous pairing claims, first-contact agent
  // registration, credential verification and the contact form. Before this
  // table nothing in either Convex tree counted a failed attempt, so a
  // six-character pairing code was a free guessing target. One row per bucket
  // key; see convex/lib/rateLimit.ts for the policy and the key namespaces.
  cmd_authAttempts: defineTable({
    /** Namespaced bucket, e.g. `claim:browser:<id>` or `register:ip:<addr>`. */
    key: v.string(),
    attempts: v.number(),
    firstAttemptAt: v.number(),
    lastAttemptAt: v.number(),
    /** Epoch ms the lockout ends. 0 when not locked. Never permanent. */
    lockedUntil: v.number(),
  })
    .index("by_key", ["key"])
    // Bounded indexed range for the retention sweep, same shape as the
    // pairing-request cleaner.
    .index("by_lastAttemptAt", ["lastAttemptAt"]),

  // Server-minted anonymous browser sessions.
  //
  // The anonymous code-pair flow used to take a client-supplied `browserUserId`
  // and write it straight into `cmd_drones.userId` as the owner. Anyone who
  // learned another browser's UUID could therefore assert ownership of that
  // browser's nodes. The owner is now DERIVED from a secret this server minted:
  // the caller presents the secret, the server resolves the row, and the owner
  // marker is `browser:<row id>`, which the caller never chooses.
  //
  // Only the SHA-256 of the secret is stored, matching the verifier-only rule
  // `cmd_mcpTokens` and `cmd_mqttControlGrants` already follow: the plaintext
  // exists in the mint response and the operator's browser, never in the table.
  cmd_browserSessions: defineTable({
    secretHash: v.string(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_secretHash", ["secretHash"])
    .index("by_lastSeenAt", ["lastSeenAt"]),
};
