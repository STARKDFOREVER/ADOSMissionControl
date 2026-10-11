/**
 * @module schemaDroneStatusCore
 * @description First half of the `cmd_droneStatus` columns: identity, host, FC, radio and video.
 *
 * Shared by every deployment; composed by `schemaTables.ts`.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";

export const droneStatusCoreFields = {
  deviceId: v.string(),
  version: v.string(),
  uptimeSeconds: v.number(),
  boardName: v.optional(v.string()),
  boardTier: v.optional(v.number()),
  boardSoc: v.optional(v.string()),
  boardArch: v.optional(v.string()),
  // Probed-from-silicon hardware truth. boardSocProbed is the kernel's
  // device-tree compatible string (authoritative over the board YAML's
  // declared soc); boardCpuProbed is the probed CPU-cluster summary;
  // hwEncoderProbed is the confirmed hardware H.264 encoder node after a
  // real trial-init. All optional so older agents round-trip cleanly.
  boardSocProbed: v.optional(v.string()),
  boardCpuProbed: v.optional(v.string()),
  hwEncoderProbed: v.optional(v.string()),
  // Running kernel release string (uname -r). Reported by the agent
  // every heartbeat so the drone-detail system area can show which
  // kernel the board booted. Older agents omit it.
  kernelRelease: v.optional(v.string()),
  // How the agent's WFB radio kernel module was provided on this
  // board: "prebuilt" (shipped binary), "dkms" (built on-device), or
  // "none" (no module present). Drives the radio-module badge.
  wfbModuleSource: v.optional(v.string()),
  // Overall health of the on-board radio stack, distinct from the
  // moment-to-moment pairing state. One of "ok" | "no_injection"
  // (no injection-capable adapter found) | "unpaired" (stack up but
  // no peer bound) | "no_bind_artifacts" (paired record missing its
  // keys/channel) | "stack_incomplete" (radio driver or transport
  // binaries missing). Drives a diagnostic line on the overview so a
  // regression in the radio install reads distinctly from a plain
  // "not paired". Absent on agents that predate the field.
  radioStackState: v.optional(v.string()),
  // Stable-MAC pin verdicts per onboard network adapter: whether a no-efuse
  // adapter that randomizes its MAC each boot was detected and pinned to a
  // stable address. An object {version, adapters:[...]}; absent on boards
  // with no such adapter. Stored as a free-form object so the per-adapter
  // shape can extend additively without a schema migration.
  macStability: v.optional(v.any()),
  // Operator management-link health from the agent's link guardian: an object
  // {state, iface, transport, backend, carrier, hasLease, gatewayReachable,
  // repairing, lastRung, lastRepairAt, repairsInWindow}. state is "healthy" |
  // "degraded" (up but no data path) | "down". Stored free-form so the shape
  // extends additively without a migration. Absent on agents that predate the
  // guardian; the GCS renders "unknown".
  managementLink: v.optional(v.any()),
  // Per-interface WiFi power-save reconciler verdicts: an object
  // {interfaces:[{iface, powersaveOn, reasserts, lastReassert, signalDbm,
  // linkState}]}. The reconciler holds power-save OFF at runtime; powersaveOn
  // reads false on a healthy interface. Stored free-form so the shape extends
  // additively without a migration. Absent on agents that predate the
  // reconciler; the GCS defaults to undefined.
  wifiPowersave: v.optional(v.any()),
  // Management-link reach-back mode from the agent's failover reconciler:
  // "primary" | "wifi_heartbeat" (degraded, status-only over onboard WiFi) |
  // "none". With the interface + reason when failed over. Absent on agents
  // that predate the reconciler; the GCS treats absence as "primary".
  mgmtLinkMode: v.optional(v.string()),
  mgmtFailoverIface: v.optional(v.union(v.string(), v.null())),
  mgmtFailoverReason: v.optional(v.union(v.string(), v.null())),
  // USB-rehome self-heal state for a slow-port WFB adapter: "idle" |
  // "rehoming" | "exhausted" | "guard_blocked", with the attempt count + last
  // outcome. Absent on agents that predate the self-heal.
  usbRehomeState: v.optional(v.string()),
  usbRehomeAttempts: v.optional(v.union(v.number(), v.null())),
  usbRehomeLastResult: v.optional(v.union(v.string(), v.null())),
  // Install-health summary from the agent's self-check at last boot.
  // One of "ok" | "degraded" | "failed" | "unknown". When degraded or
  // failed, `failedSteps` lists the install steps that did not pass.
  installStatus: v.optional(v.string()),
  // Agent install/build version recorded by the installer. May be
  // absent on agents that predate the install-health surface.
  installVersion: v.optional(v.string()),
  // Names of install steps that failed or degraded during the last
  // install/self-check. Empty or absent when the install is healthy.
  failedSteps: v.optional(v.array(v.string())),
  cpuPercent: v.optional(v.number()),
  memoryPercent: v.optional(v.number()),
  diskPercent: v.optional(v.number()),
  temperature: v.optional(v.float64()),
  fcConnected: v.optional(v.boolean()),
  fcPort: v.optional(v.string()),
  fcBaud: v.optional(v.number()),
  // Gated MAVLink truth — siblings of fcConnected. transportOpen = transport
  // open; mavlinkAlive = a HEARTBEAT decoded within the freshness window;
  // heartbeatAgeS = seconds since the last one; fcSource = resolved source;
  // fcLinkHint = diagnostic hint for a not-alive link ("none" |
  // "msp_detected" | "no_heartbeat"). All optional so heartbeats from agents
  // that predate the gated truth stay additive.
  transportOpen: v.optional(v.boolean()),
  mavlinkAlive: v.optional(v.boolean()),
  heartbeatAgeS: v.optional(v.number()),
  fcSource: v.optional(v.string()),
  fcLinkHint: v.optional(v.string()),
  // FC protocol family the agent identified ("betaflight" | "inav" for an MSP
  // FC), so a cloud-relayed MSP FC drives the MSP adapter + MSP relay lane.
  // Optional so heartbeats from agents that predate the field stay additive.
  fcVariant: v.optional(v.string()),
  // Canonical FC firmware family ("ardupilot" | "px4" | "betaflight" | "inav")
  // so a cloud-relay GCS can badge the family (incl. ArduPilot vs PX4). Optional.
  fcFirmware: v.optional(v.string()),
  // fcReachable = honest connected-or-reachable verdict (true for a healthy
  // MSP FC that never emits the HEARTBEAT the alive gate needs). Emitted as
  // a plain boolean on every packaged-loop heartbeat, so a validator that
  // omits it rejects the entire heartbeat. Optional for older agents.
  fcReachable: v.optional(v.boolean()),
  // True when the FC link reads connected but GCS commands to the FC are
  // dropped (telemetry-only source such as MAVLink over ELRS). Optional.
  fcCommandDownGated: v.optional(v.boolean()),
  // Absolute resource values
  memoryUsedMb: v.optional(v.number()),
  memoryTotalMb: v.optional(v.number()),
  // Detailed memory breakdown: available (allocatable without swapping),
  // page-cache, and swap usage. Optional so heartbeats from agents that
  // predate the breakdown stay additive.
  memoryAvailableMb: v.optional(v.number()),
  memoryCacheMb: v.optional(v.number()),
  swapTotalMb: v.optional(v.number()),
  swapUsedMb: v.optional(v.number()),
  swapPercent: v.optional(v.number()),
  diskUsedGb: v.optional(v.number()),
  diskTotalGb: v.optional(v.number()),
  cpuCores: v.optional(v.number()),
  boardRamMb: v.optional(v.number()),
  // Process-level totals (single-process architecture)
  processCpuPercent: v.optional(v.number()),
  processMemoryMb: v.optional(v.number()),
  // History arrays for sparkline charts (last 60 samples, 5s interval = 5 min)
  cpuHistory: v.optional(v.array(v.number())),
  memoryHistory: v.optional(v.array(v.number())),
  services: v.optional(v.array(v.object({
    name: v.string(),
    status: v.string(),
    cpuPercent: v.optional(v.number()),
    memoryMb: v.optional(v.number()),
    uptimeSeconds: v.optional(v.number()),
    pid: v.optional(v.number()),
    category: v.optional(v.string()),
  }))),
  lastIp: v.optional(v.string()),
  mdnsHost: v.optional(v.string()),
  setupUrl: v.optional(v.string()),
  apiUrl: v.optional(v.string()),
  missionControlUrl: v.optional(v.string()),
  // Video pipeline status for GCS auto-discovery
  videoState: v.optional(v.string()),
  videoWhepPort: v.optional(v.number()),
  videoWhepUrl: v.optional(v.string()),
  // Per-leg video streams a multi-stream node serves. `whepUrl` is the
  // same-origin relative WHEP path the node serves for that leg; the GCS
  // resolves it against the node's reachable base URL.
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
  // Count of pipeline restarts since the last healthy interval.
  // Resets to zero on the agent side once video stays up for the
  // configured cool-down. The GCS surfaces a banner when the count
  // crosses an unhealthy threshold so operators can spot a flapping
  // pipeline without trawling logs.
  videoRestartAttempts: v.optional(v.number()),
  mavlinkWsPort: v.optional(v.number()),
  mavlinkWsUrl: v.optional(v.string()),
  // LAN-routable manual-connection URLs the agent advertises so
  // the operator can dial directly from a workstation on the same
  // network. All optional; each independently null when the agent
  // can't compute a usable URL (no MAVLink TCP listener, no video
  // pipeline, etc.).
  manualConnectionUrls: v.optional(
    v.object({
      mavlinkTcp: v.optional(v.union(v.string(), v.null())),
      mavlinkWs: v.optional(v.union(v.string(), v.null())),
      // Ticket-gated authenticated MAVLink WebSocket endpoint
      // (ground-station profile), as an absolute URL or a path
      // relative to the agent front. Sibling of mavlinkWs. Null when
      // the agent does not advertise the gated endpoint.
      mavlinkWsAuthenticated: v.optional(v.union(v.string(), v.null())),
      videoViewer: v.optional(v.union(v.string(), v.null())),
      videoWhep: v.optional(v.union(v.string(), v.null())),
    }),
  ),
  // Cloud relay = MQTT-to-Convex pair, Cloudflare = inbound tunnel.
  // Split because the prior single "Remote" surface conflated them.
  cloudRelayUrl: v.optional(v.union(v.string(), v.null())),
  cloudflareUrl: v.optional(v.union(v.string(), v.null())),
  // Cloud posture chosen on the agent: "local" | "cloud" | "self_hosted".
  // The drone card renders a "Local-only" pill when this is "local" so
  // operators distinguish an intentionally offline drone from one that
  // dropped off. Absent on older agents — default to "cloud" client-side.
  cloudPosture: v.optional(v.string()),
  // Webapp-side plugin installs reported by the agent. Lets the GCS
  // per-drone Plugins tab surface installs made directly from the
  // agent's local dashboard (port 8080) without a separate fetch.
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
  // Per-peripheral connection states sampled at the agent every
  // heartbeat. The full peripheral manifests live in
  // ``peripherals`` (untyped); this compact array drives the
  // connected/disconnected dot on the drone card without re-pulling
  // the manifest body.
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
  // No writer: kept only so a row stored before the heartbeat stopped
  // declaring it still validates. Schema changes here are additive.
  logs: v.optional(v.any()),
  // Backend variant the agent process is running. "lite" hides
  // the plugin host, peripheral manager, and scripting surfaces
  // in Mission Control. Absent values default to "full".
  runtimeMode: v.optional(v.string()),
  // Wire-contract identity for the Command-tab node hub. "profile"
  // is "drone" or "ground-station"; "role" is "direct" | "relay" |
  // "receiver" on a ground station, null on a drone. Older agents
  // that don't emit these fields default the GCS to "drone".
  profile: v.optional(v.string()),
  role: v.optional(v.string()),
  // Pairing/uplink failover state. "local" = steady wireless link.
  // "cloud_relay" = local supervisor fell over to the cloud heartbeat
  // path; the GCS shows a notice with a retry control. "failed" =
  // both paths down. Undefined for agents that predate the failover
  // supervisor; the GCS treats absent as "local".
  wfbFailoverState: v.optional(v.string()),
  // Ground-station cloud-relay state, posted by the uplink-aware relay
  // bridge when a ground station is in cloud mode. All optional so a drone
  // (or a GS with no active uplink) round-trips cleanly. "uplink" is the
  // active uplink iface; "throttleState" follows the data-cap ladder
  // ("ok" | "throttle_80" | "throttle_95"); "forwarding*" are the live
  // forwarding decisions derived from that ladder.
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
  // Perception tier this node runs on (where detection / tracking runs):
  // "local" (own NPU) | "offload" (a paired compute node) | "hybrid" | "none".
  // "perceptionOffloadTarget" names the workstation the drone is offloading to
  // (host:port), present only on an actual offload path (never a fabricated
  // reach). Both mirror the native /api/status so the LAN and cloud surfaces
  // agree. This OSS-twin /agent/status route PICKS fields explicitly, so each
  // is also listed in http.ts's statusPayload pick list.
  perceptionTier: v.optional(v.string()),
  perceptionOffloadTarget: v.optional(v.string()),
};
