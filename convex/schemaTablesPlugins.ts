/**
 * @module schemaTablesPlugins
 * @description Signing, plugin, MCP, broker-grant and log-window tables.
 *
 * Shared by every deployment; composed by `schemaTables.ts`.
 *
 * @license GPL-3.0-only
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  gcsContributesValidator,
  gcsIsolationValidator,
  gcsParametersValidator,
  flightSkillsValidator,
  targetActionsValidator,
} from "./cmdPluginsValidators";

export const pluginTables = {
  // Legacy rows for MAVLink v2 signing-key cloud sync. New plaintext uploads
  // are disabled until encrypted storage is available. Function logs MUST NOT
  // echo keyHex. See convex/cmdSigningKeys.ts.
  cmd_signingKeys: defineTable({
    userId: v.string(),
    droneId: v.string(),
    keyHex: v.string(),                   // 64-char hex, plaintext (v1 trust model)
    keyId: v.string(),                    // 8-char sha256 fingerprint, log-safe
    linkIdOwner: v.number(),              // this row's owning link_id
    linkIdsInUse: v.array(v.number()),    // every link_id claimed by any device for this drone
    enrolledAt: v.string(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_drone", ["userId", "droneId"]),

  // Append-only audit log for signing events. Log-safe fields only:
  // keyId (8-char fingerprint) is stored, keyHex is NEVER stored here.
  // Compliance exports read this table to produce a timeline of every
  // signing action per drone per user.
  cmd_signingEvents: defineTable({
    userId: v.string(),
    droneId: v.string(),
    eventType: v.union(
      v.literal("enrollment"),
      v.literal("rotation"),
      v.literal("import"),
      v.literal("export"),
      v.literal("disable"),
      v.literal("cloud_sync_on"),
      v.literal("cloud_sync_off"),
      v.literal("clear_fc"),
      v.literal("key_mismatch_detected"),
      v.literal("user_purge_on_signout"),
      v.literal("fc_rejected_enrollment"),
      v.literal("require_on"),
      v.literal("require_off"),
    ),
    keyIdOld: v.optional(v.string()),
    keyIdNew: v.optional(v.string()),
    deviceFingerprint: v.string(),        // hashed browser id, not raw
    createdAt: v.number(),
  })
    .index("by_user_drone", ["userId", "droneId"])
    .index("by_user_created", ["userId", "createdAt"]),

  // Plugin install record. One row per (user, droneId, pluginId). The
  // GCS reads this to decide which plugins to mount and where; the
  // agent writes status updates through cloud relay or the user's
  // hosted Convex deployment.
  cmd_pluginInstalls: defineTable({
    userId: v.string(),
    droneId: v.optional(v.string()),       // null = GCS-only plugin
    pluginId: v.string(),                  // reverse-DNS, e.g. com.flir.thermal
    version: v.string(),                   // semver
    name: v.string(),
    source: v.union(
      v.literal("local_file"),
      v.literal("git_url"),
      v.literal("registry"),
      v.literal("builtin")
    ),
    sourceUri: v.optional(v.string()),
    signerId: v.optional(v.string()),
    manifestHash: v.string(),              // sha256 of manifest yaml
    status: v.union(
      v.literal("installed"),              // unpacked, perms not granted
      v.literal("enabled"),                // perms granted, awaiting start
      v.literal("running"),
      v.literal("disabled"),
      v.literal("crashed"),
      v.literal("removed")
    ),
    bundleStorageId: v.optional(v.id("_storage")),  // GCS half blob, if any
    // Denormalized gcs.contributes slot entries from the manifest, so the
    // contribution producer mounts plugins without fetching the manifest
    // blob each render. Populated at install time from the parsed manifest.
    gcsContributes: v.optional(gcsContributesValidator),
    // How the GCS half mounts. Absent = "iframe".
    gcsIsolation: v.optional(gcsIsolationValidator),
    // Denormalized declarative parameter contributions from the manifest, so
    // the native parameter panel renders a plugin's settings form without
    // re-fetching the manifest. Additive-optional; older rows omit it.
    gcsParameters: v.optional(gcsParametersValidator),
    // Denormalized flight-skill contributions from the manifest, so the cockpit
    // Skill Bar mounts a plugin skill for a cloud operator without re-fetching
    // the manifest. Additive-optional; older rows omit it.
    flightSkills: v.optional(flightSkillsValidator),
    // Denormalized cockpit target-action contributions from the manifest, so
    // the click-a-target popup lists them for a cloud operator. Additive.
    targetActions: v.optional(targetActionsValidator),
    halves: v.array(v.union(v.literal("agent"), v.literal("gcs"))),
    installedAt: v.number(),
    enabledAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_drone", ["droneId"])
    .index("by_installed_at", ["installedAt"])
    // Installs are per drone: the install upsert and the per-drone view both
    // key on (user, droneId, pluginId).
    .index("by_user_drone_plugin", ["userId", "droneId", "pluginId"]),

  // GCS iframe bundles stored by the server for their uploader. An install row
  // may only reference a bundle its own user stored here, so a storage id
  // learned elsewhere cannot be turned into a signed download URL.
  cmd_pluginBundles: defineTable({
    userId: v.string(),
    storageId: v.id("_storage"),
    createdAt: v.number(),
  }).index("by_storageId", ["storageId"]),

  // Per-permission grant. Two-stage install dialog records each
  // declared permission as a row with granted=false; operator approval
  // flips granted=true and stamps grantedAt + grantedBy.
  cmd_pluginPermissions: defineTable({
    userId: v.string(),
    pluginInstallId: v.id("cmd_pluginInstalls"),
    pluginId: v.string(),                  // denormalized for fast filter
    permissionId: v.string(),              // e.g. event.publish
    granted: v.boolean(),
    required: v.boolean(),
    grantedAt: v.optional(v.number()),
    grantedBy: v.optional(v.string()),     // userId of approver
    revokedAt: v.optional(v.number()),
  })
    .index("by_install", ["pluginInstallId"])
    .index("by_user_plugin", ["userId", "pluginId"])
    .index("by_install_perm", ["pluginInstallId", "permissionId"]),

  // Append-only event log per plugin: lifecycle, capability denials,
  // crashes, operator actions. 30-day retention, swept by the
  // `prune-old-plugin-events` cron (cmdPluginsMaintenance.pruneOldEvents).
  cmd_pluginEvents: defineTable({
    userId: v.string(),
    pluginInstallId: v.id("cmd_pluginInstalls"),
    pluginId: v.string(),
    type: v.union(
      v.literal("installed"),
      v.literal("enabled"),
      v.literal("disabled"),
      v.literal("removed"),
      v.literal("started"),
      v.literal("stopped"),
      v.literal("crashed"),
      v.literal("permission_granted"),
      v.literal("permission_revoked"),
      v.literal("permission_denied"),
      v.literal("update_available"),
      v.literal("update_applied"),
      v.literal("operator_note")
    ),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("error")
    ),
    message: v.string(),
    payload: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_install", ["pluginInstallId"])
    .index("by_user_plugin", ["userId", "pluginId"])
    .index("by_install_type", ["pluginInstallId", "type"])
    .index("by_user_created", ["userId", "createdAt"])
    // Retention sweep: range every user's rows by age in one bounded indexed
    // read. `by_user_created` cannot serve it — the sweep is fleet-wide and
    // would have to walk one range per user to use that index.
    .index("by_createdAt", ["createdAt"]),

  // Plugin-owned cloud records: small JSON documents a plugin stores under
  // the operator's account, keyed (collection, key) inside the plugin's own
  // namespace. The GCS half writes through `pluginRecords` (writtenBy "gcs"),
  // the agent half through `POST /agent/plugin-records` (writtenBy "agent").
  // Access needs an enabled install with the `cloud.records` grant; the
  // plugin id is always bound by the host, never taken from plugin input.
  plugin_records: defineTable({
    userId: v.string(),
    pluginId: v.string(),
    deviceId: v.optional(v.string()), // node the record is about, if any
    collection: v.string(),
    key: v.string(),
    data: v.any(),
    sizeBytes: v.number(), // UTF-8 length of the JSON-encoded data
    writtenBy: v.union(v.literal("gcs"), v.literal("agent")),
    updatedAt: v.number(),
  })
    .index("by_user_plugin_collection_key", ["userId", "pluginId", "collection", "key"])
    .index("by_user_plugin_device", ["userId", "pluginId", "deviceId"])
    .index("by_device", ["deviceId"]),

  // Live row count per (user, plugin) in `plugin_records`, so the per-plugin
  // record cap is one indexed read instead of a scan of up to the cap's worth
  // of documents. Maintained by every insert and delete of a record row.
  plugin_record_counts: defineTable({
    userId: v.string(),
    pluginId: v.string(),
    count: v.number(),
  }).index("by_user_plugin", ["userId", "pluginId"]),

  // Uploaded .adosplug archive blobs keyed by (userId, sha256). One
  // row per uploaded archive; reused across drones so a fleet-wide
  // install does not re-upload the same payload. Manifest
  // hash, declared permissions, and signature travel with the row so
  // the install dialog and the agent both verify against the same
  // source of truth.
  plugin_archives: defineTable({
    userId: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    sizeBytes: v.number(),
    sha256: v.string(),
    pluginId: v.string(),
    version: v.string(),
    manifestHash: v.string(),
    declaredPermissions: v.array(v.object({
      id: v.string(),
      required: v.boolean(),
    })),
    signerId: v.optional(v.string()),
    signatureB64: v.optional(v.string()),
    uploadedAt: v.number(),
    // Never read. Rows stored before the counter was dropped still carry it;
    // new rows do not. Remove once those rows are rewritten.
    refCount: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_plugin_version", ["userId", "pluginId", "version"])
    .index("by_sha256", ["sha256"])
    .index("by_storageId", ["storageId"]),

  // Cloud-relay install job. Carries the GCS → cloud → agent install
  // request through the six-stage state machine. Each job is scoped
  // to a single (operator, drone, plugin) install. cmdId is set on
  // the cloud-relay path so the agent's command poller can correlate
  // job updates with the queue row; left undefined on a LAN-direct
  // install. installId is set once cmd_pluginInstalls has been
  // created so the GCS can deep-link from the job into the install.
  plugin_install_jobs: defineTable({
    userId: v.string(),
    operatorId: v.string(),
    deviceId: v.string(),
    archiveId: v.id("plugin_archives"),
    pluginId: v.string(),
    version: v.string(),
    requestedPermissions: v.array(v.string()),
    // State machine:
    // queued | commanded | downloading | verifying | installing
    // | completed | failed | cancelled
    stage: v.string(),
    cmdId: v.optional(v.id("cmd_droneCommands")),
    installId: v.optional(v.id("cmd_pluginInstalls")),
    error: v.optional(v.object({
      code: v.string(),
      message: v.string(),
    })),
    attempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_device_stage", ["deviceId", "stage"])
    .index("by_cmd", ["cmdId"]),

  // Per-operator HMAC secret used to mint capability tokens for the
  // GCS → agent plugin RPC bridge. Rotated monthly; previousSecretBase64
  // covers the overlap window so tokens minted just before rotation
  // remain valid until they expire.
  operator_hmac_secrets: defineTable({
    userId: v.string(),
    secretBase64: v.string(),
    rotatedAt: v.number(),
    previousSecretBase64: v.optional(v.string()),
  })
    .index("by_user", ["userId"]),

  // ADOS MCP machine credentials. An operator mints one scoped, revocable, opaque
  // credential in the MCP tab and runs the MCP server with it; only the SHA-256
  // hash is stored, so a DB read cannot recover a usable credential. Verified by
  // `cmdMcpReach`; the plaintext is returned once at mint (`cmdMcpTokens.mint`).
  cmd_mcpTokens: defineTable({
    userId: v.string(),
    tokenId: v.string(),
    tokenHash: v.string(),
    scopes: v.array(v.string()),
    allowedNodes: v.array(v.string()),
    label: v.string(),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_tokenHash", ["tokenHash"]),

  // Per-operator broker write grants for the cloud relay. The browser's shared
  // broker credential is read-only, so a relay session can watch a drone and
  // cannot command it; a grant is the scoped, expiring credential that lets one
  // operator publish FC frames and video signaling offers for the devices they
  // own, without handing every browser a fleet-wide write key.
  //
  // `passwdEntry` is the broker's own verifier (see `mosquittoPasswd`), not the
  // secret: the plaintext is returned once at mint and never stored, so a read
  // of this table cannot authenticate anything. `principal` is deliberately
  // opaque rather than derived from the user id, because it is written into a
  // file on the broker host and should not carry operator identity.
  //
  // Writes are narrowed per device at the ACL, not here: holding a grant is not
  // the same as being permitted a topic, and the broker remains the authority.
  cmd_mqttControlGrants: defineTable({
    userId: v.string(),
    /** Opaque broker username, e.g. `gcs-op-<random>`. */
    principal: v.string(),
    /** Broker password-file line. A verifier, never the secret. */
    passwdEntry: v.string(),
    /** Devices this grant authorises writes for, at mint time. */
    deviceIds: v.array(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    /** Last time the holder proved the broker accepted a write. */
    lastConfirmedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_principal", ["principal"])
    .index("by_expiresAt", ["expiresAt"]),

  // ADOS MCP audit mirror: one lean, already-redacted row per tool call an AI
  // client made through the MCP server, so the Mission Control MCP tab reads a
  // single cross-node history instead of each node's local store. The full
  // (redacted) argument map stays in the server's local file + the agent log
  // store; this mirror carries only what the Audit Log renders. Rows are pushed
  // by the credential-holding server via cmdMcpReach.recordAudit and scoped to
  // the owning operator. Idempotent on contentHash so a re-push never duplicates.
  cmd_mcpAuditEvents: defineTable({
    userId: v.string(),
    tokenId: v.string(),
    tool: v.string(),
    node: v.string(),
    decision: v.union(
      v.literal("allowed"),
      v.literal("denied"),
      v.literal("confirmed"),
      v.literal("operator_absent"),
    ),
    result: v.string(),
    plane: v.union(v.literal("lan_direct"), v.literal("cloud_relay"), v.literal("on_box")),
    latencyMs: v.number(),
    tsUs: v.number(),
    mcpSession: v.optional(v.string()),
    argsRedacted: v.optional(v.boolean()),
    sensitiveRead: v.optional(v.boolean()),
    contentHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_contentHash", ["contentHash"])
    // Retention sweep: one bounded fleet-wide read by age. Every MCP tool call
    // appends a row here, so this table has the highest write cadence of the
    // append-only pair and no natural end.
    .index("by_createdAt", ["createdAt"]),

  // Explicitly exported on-device log windows. The agent's durable
  // local log store stays the source of truth; an operator can push a
  // chosen window (a session, or a closed time range, for one record
  // kind) to the paired cloud account as a revocable export. One row
  // per stored blob. Dedup is by (deviceId, contentHash) where
  // contentHash is the SHA-256 the server recomputes from the stored
  // bytes (never a client claim), so re-pushing the same deterministic
  // window is a no-op that reuses the existing row. userId is
  // denormalized from the paired device record at insert so account
  // cleanup can cascade without a join.
  logd_windows: defineTable({
    userId: v.string(),
    deviceId: v.string(),
    sessionId: v.string(),       // "" when the window had no session
    kind: v.string(),            // logs | metrics | events | hw | mixed
    windowStartUs: v.number(),
    windowEndUs: v.number(),
    contentHash: v.string(),     // server-recomputed sha256(bytes), hex
    format: v.string(),          // jsonl.zst | jsonl
    rowCount: v.number(),
    sizeBytes: v.number(),
    storageId: v.id("_storage"),
    pushedAt: v.number(),        // epoch ms
  })
    .index("by_device_hash", ["deviceId", "contentHash"])
    .index("by_device_pushedAt", ["deviceId", "pushedAt"])
    .index("by_user", ["userId"])
    // Retention sweep: range exported windows by age so the cleanup cron
    // deletes old rows (and their stored blobs) with a bounded indexed scan.
    .index("by_pushedAt", ["pushedAt"]),
};
