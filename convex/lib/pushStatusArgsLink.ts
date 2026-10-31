/**
 * @module convex/lib/pushStatusArgsLink
 * @description `pushStatus` heartbeat args: video, MAVLink, network and WFB link.
 * Spread into `pushStatusArgs`; see `./pushStatusArgs`.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";

export const linkStatusArgs = {
  // Video pipeline status for GCS auto-discovery
  videoState: v.optional(v.string()),
  videoWhepPort: v.optional(v.number()),
  videoWhepUrl: v.optional(v.string()),
  videoStreams: v.optional(
    v.array(
      v.object({
        id: v.string(),
        role: v.optional(v.string()),
        codec: v.optional(v.string()),
        live: v.optional(v.boolean()),
        whepUrl: v.optional(v.string()),
      }),
    ),
  ),
  videoRestartAttempts: v.optional(v.number()),
  mavlinkWsPort: v.optional(v.number()),
  mavlinkWsUrl: v.optional(v.string()),
  manualConnectionUrls: v.optional(
    v.object({
      mavlinkTcp: v.optional(v.union(v.string(), v.null())),
      mavlinkWs: v.optional(v.union(v.string(), v.null())),
      mavlinkWsAuthenticated: v.optional(v.union(v.string(), v.null())),
      videoViewer: v.optional(v.union(v.string(), v.null())),
      videoWhep: v.optional(v.union(v.string(), v.null())),
    }),
  ),
  cloudRelayUrl: v.optional(v.union(v.string(), v.null())),
  cloudflareUrl: v.optional(v.union(v.string(), v.null())),
  cloudPosture: v.optional(v.string()),
  pluginInventory: v.optional(
    v.array(
      v.object({
        plugin_id: v.string(),
        version: v.optional(v.union(v.string(), v.null())),
        status: v.optional(v.union(v.string(), v.null())),
        // Per-model delivery outcome (resolved / needs_model / verify_failed),
        // one entry per declared model id. Additive + optional.
        model_status: v.optional(
          v.array(
            v.object({
              state: v.string(),
              model_id: v.string(),
              runtime: v.optional(v.union(v.string(), v.null())),
              path: v.optional(v.union(v.string(), v.null())),
              reason: v.optional(v.union(v.string(), v.null())),
            }),
          ),
        ),
        // Per-service readiness (ready + reason), one entry per declared
        // service. Additive + optional.
        service_status: v.optional(
          v.array(
            v.object({
              name: v.string(),
              ready: v.boolean(),
              reason: v.optional(v.union(v.string(), v.null())),
            }),
          ),
        ),
      }),
    ),
  ),
  peripheralStates: v.optional(
    v.array(
      v.object({
        id: v.string(),
        connected: v.boolean(),
        last_seen: v.optional(v.union(v.number(), v.null())),
      }),
    ),
  ),
  remoteAccess: v.optional(v.any()),
  peripherals: v.optional(v.any()),
  scripts: v.optional(v.any()),
  enrollment: v.optional(v.any()),
  peers: v.optional(v.any()),
  telemetry: v.optional(v.any()),
  runtimeMode: v.optional(v.string()),
  // Wire-contract identity for the Command-tab node hub. "profile"
  // is "drone" or "ground-station"; "role" is "direct" | "relay" |
  // "receiver" on a ground station, null on a drone. Older agents
  // that don't emit these fields default the GCS to "drone".
  profile: v.optional(v.string()),
  role: v.optional(v.string()),
  wfbFailoverState: v.optional(v.string()),
  // Ground-station cloud-relay state from the uplink-aware relay bridge.
  // All optional so the drone heartbeat (and a GS with no active uplink)
  // round-trip cleanly. NOTE: this OSS-twin /agent/status route PICKS fields
  // explicitly (it does not spread the body like the production deployment),
  // so each of these is also listed in http.ts's statusPayload pick list.
  uplink: v.optional(v.string()),
  mqttConnected: v.optional(v.boolean()),
  throttleState: v.optional(v.string()),
  forwardingVideo: v.optional(v.boolean()),
  forwardingTelemetry: v.optional(v.boolean()),
  tsMs: v.optional(v.number()),
  // NPU capability the board declares: npuTops (declared TOPS, 0 when none)
  // + hasAccelerator. Siblings of perceptionTier from the same heartbeat
  // surface; the agent emits both as plain scalars on EVERY heartbeat, so a
  // validator that omits them rejects the entire heartbeat. Optional so an
  // agent that predates the surface round-trips cleanly.
  npuTops: v.optional(v.number()),
  hasAccelerator: v.optional(v.boolean()),
  // Perception tier + the offload target (host:port) this node reports, mirror
  // of the native /api/status so the LAN and cloud surfaces agree. Absent on an
  // agent that predates the surface. This OSS-twin /agent/status route PICKS
  // fields explicitly, so each is also listed in http.ts's statusPayload.
  perceptionTier: v.optional(v.string()),
  perceptionOffloadTarget: v.optional(v.string()),
  // Generic plugin-state channel: { "<plugin id>": <opaque slice> }. A plugin
  // surfaces its own telemetry under its plugin id without core columns. The
  // OSS-twin /agent/status route picks this one field; the slice is opaque
  // (the plugin owns it).
  pluginState: v.optional(v.record(v.string(), v.any())),
  setupState: v.optional(v.string()),
  profileSource: v.optional(v.string()),
  // Top-level mirror of the selected WFB radio adapter (also nested in
  // the radio block below). Optional so older agents round-trip
  // cleanly; persisted verbatim via the args spread in the handler.
  wfbAdapterChipset: v.optional(v.union(v.string(), v.null())),
  wfbAdapterInjectionOk: v.optional(v.union(v.boolean(), v.null())),
  // USB link health of the selected adapter, mirrored at the top level
  // (also nested in the radio block below at adapterUsbDegraded/
  // adapterUsbSpeedMbps). The HTTP relay forwards these two as top-level
  // fields; a strict args validator that omits them throws inside
  // runMutation and fails the ENTIRE heartbeat the moment an agent emits a
  // real bool/number. Declared here (the schema already carries them) so
  // they round-trip. Optional + nullable: older agents omit them.
  wfbAdapterUsbDegraded: v.optional(v.union(v.boolean(), v.null())),
  wfbAdapterUsbSpeedMbps: v.optional(v.union(v.number(), v.null())),
};
