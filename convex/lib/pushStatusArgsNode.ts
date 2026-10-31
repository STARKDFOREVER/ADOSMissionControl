/**
 * @module convex/lib/pushStatusArgsNode
 * @description `pushStatus` heartbeat args: node lanes, LCD surface, plugins, peripherals, peers and config errors.
 * Spread into `pushStatusArgs`; see `./pushStatusArgs`.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";

export const nodeStatusArgs = {
  // Node lane flags (matches schema.ts cmd_droneStatus).
  gnss: v.optional(v.boolean()),
  lora: v.optional(v.boolean()),
  sim: v.optional(v.boolean()),
  // Local SPI LCD surface state (matches schema.ts cmd_droneStatus).
  lcdActivePage: v.optional(v.string()),
  lcdTouchCalibrated: v.optional(v.boolean()),
  lcdRotation: v.optional(v.number()),
  lcdSnapshotUrl: v.optional(v.string()),
  lcdLastTouchAt: v.optional(v.number()),
  lcdLastGesture: v.optional(v.string()),
  // Local on-board video surface (LCD video page tap + recording).
  videoLocalDecoderActive: v.optional(v.boolean()),
  videoLocalDecoderType: v.optional(v.string()),
  videoLocalDecoderFps: v.optional(v.number()),
  videoRecording: v.optional(v.boolean()),
  // Operator-selected UI theme on the agent.
  uiTheme: v.optional(v.string()),
  // Effective primary local-display path resolved each heartbeat
  // ("hdmi" | "lcd" | "none"). Reflects the ground_station.display.type
  // config when explicit; resolved by HDMI / LCD probe when "auto".
  displayType: v.optional(v.string()),
  // Epoch ms of the last plugin-update registry sweep on the agent.
  last_plugin_update_check_at: v.optional(v.number()),
  // Inter-rig peer presence — sourced from the agent's HopListener
  // peer cache (WFB-radio PresenceBeacon stream). Drone heartbeats
  // carry the GS's identity; GS heartbeats carry the drone's.
  peerDeviceId: v.optional(v.union(v.string(), v.null())),
  peerRole: v.optional(v.union(v.string(), v.null())),
  peerChannel: v.optional(v.union(v.number(), v.null())),
  peerRssiDbm: v.optional(v.union(v.number(), v.null())),
  peerSeenAtUnix: v.optional(v.union(v.number(), v.null())),
  // The LIST of WFB peers a ground station relays. A GS can be linked to
  // more than one drone, which the scalar peer* fields above cannot carry;
  // this is the list a GCS paired only to the ground node reads to enrol
  // each drone. Each entry carries only what the beacon + listener decode.
  // The inner v.object is strict, so it declares exactly the producer's
  // camelCase key set; an undeclared key would reject the whole heartbeat.
  linkedPeers: v.optional(
    v.array(
      v.object({
        deviceId: v.string(),
        role: v.optional(v.union(v.string(), v.null())),
        channel: v.optional(v.union(v.number(), v.null())),
        rssiDbm: v.optional(v.union(v.number(), v.null())),
        seenAtUnix: v.optional(v.union(v.number(), v.null())),
      }),
    ),
  ),
  // Primary camera discovery state — "ready" | "missing" | "error".
  cameraState: v.optional(v.union(v.string(), v.null())),
  // USB camera-recovery self-heal state from the air-side reconciler.
  // state is "idle" | "monitoring" | "rebinding" | "port_cycling" |
  // "hub_resetting" | "needs_hub_reset" | "guard_blocked" | "exhausted";
  // `case` is the agent's diagnosis string (or null); the remaining fields
  // bound the recovery episode. Inner fields are optional + nullable so a
  // slightly older agent payload still round-trips. Without this
  // declaration the strict validator would reject the whole heartbeat once
  // the relay forwards the object. Consumed by the GCS capability store.
  cameraUsbRecovery: v.optional(
    v.object({
      state: v.optional(v.union(v.string(), v.null())),
      case: v.optional(v.union(v.string(), v.null())),
      attempts: v.optional(v.union(v.number(), v.null())),
      maxAttempts: v.optional(v.union(v.number(), v.null())),
      cameraPresent: v.optional(v.union(v.boolean(), v.null())),
      expected: v.optional(v.union(v.boolean(), v.null())),
      pppsCapable: v.optional(v.union(v.boolean(), v.null())),
    }),
  ),
  // FC CAN bus configuration harvested from the persisted parameter
  // cache. The agent emits an array of {port, driver, bitrate,
  // protocol} entries once the cache holds at least one CAN_P*_*
  // value. Absent during the warmup window between FC connect and
  // the first parameter download finishing. Forwarded straight to
  // the cloud row so the GCS can render the per-port configuration
  // on the drone card without re-querying the FC.
  canBuses: v.optional(v.array(v.object({
    port: v.number(),
    driver: v.number(),
    bitrate: v.number(),
    protocol: v.number(),
  }))),
  // Vision engine summary (see schema.ts cmd_droneStatus comment).
  // Active model id + inference backend + rolling throughput. All
  // optional so an agent that predates the vision surface round-trips
  // cleanly.
  visionActiveModel: v.optional(v.union(v.string(), v.null())),
  visionBackend: v.optional(v.union(v.string(), v.null())),
  visionDetectionsPerSec: v.optional(v.number()),
  visionFps: v.optional(v.number()),
  // Per-service config-load errors. Each entry names a service whose config
  // file failed to parse (the agent kept running on defaults). Present only
  // for services in an errored state; absent when every config loaded
  // cleanly. This OSS-twin /agent/status route PICKS fields explicitly, so
  // this is also listed in http.ts's statusPayload pick list.
  configErrors: v.optional(
    v.array(
      v.object({
        service: v.string(),
        error: v.string(),
      }),
    ),
  ),
};
