/**
 * @module convex/lib/pushStatusArgsSystem
 * @description `pushStatus` heartbeat args: identity, host resources, services, access URLs.
 * Spread into `pushStatusArgs`; see `./pushStatusArgs`.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";

export const systemStatusArgs = {
  deviceId: v.string(),
  version: v.string(),
  uptimeSeconds: v.number(),
  boardName: v.optional(v.string()),
  boardTier: v.optional(v.number()),
  boardSoc: v.optional(v.string()),
  boardArch: v.optional(v.string()),
  // Probed-from-silicon hardware truth (kernel device-tree SoC, CPU
  // cluster summary, confirmed hardware H.264 encoder node). Optional so
  // older agents round-trip cleanly; persisted via the args spread.
  boardSocProbed: v.optional(v.string()),
  boardCpuProbed: v.optional(v.string()),
  hwEncoderProbed: v.optional(v.string()),
  // Kernel release + radio-module source + install-health summary.
  // All optional so an agent that predates the surface round-trips
  // cleanly; mirrors the boardArch/boardSoc handling.
  kernelRelease: v.optional(v.string()),
  wfbModuleSource: v.optional(v.string()),
  // Overall radio-stack health, distinct from the live pairing state.
  // One of "ok" | "no_injection" | "unpaired" | "no_bind_artifacts" |
  // "stack_incomplete". Persisted verbatim via the args spread so a
  // regression in the radio install surfaces on the overview. Older
  // agents omit it and the GCS defaults to a safe undefined.
  radioStackState: v.optional(v.string()),
  // Stable-MAC pin verdicts (object {version, adapters:[...]}). Older agents
  // omit it; the GCS defaults to a safe undefined.
  macStability: v.optional(v.any()),
  // Operator management-link health (object {state, iface, transport,
  // backend, carrier, hasLease, gatewayReachable, repairing, lastRung,
  // lastRepairAt, repairsInWindow}). Stored free-form so the shape extends
  // additively. Older agents omit it; the GCS defaults to undefined.
  managementLink: v.optional(v.any()),
  // Per-interface WiFi power-save reconciler verdicts (object
  // {interfaces:[...]}). Stored free-form so the shape extends additively.
  // Older agents omit it; the GCS defaults to a safe undefined.
  wifiPowersave: v.optional(v.any()),
  // Management-link reach-back mode + failover interface/reason. Older agents
  // omit these; the GCS treats absence as "primary".
  mgmtLinkMode: v.optional(v.string()),
  mgmtFailoverIface: v.optional(v.union(v.string(), v.null())),
  mgmtFailoverReason: v.optional(v.union(v.string(), v.null())),
  // USB-rehome self-heal state + attempt count + last outcome. Older agents
  // omit these.
  usbRehomeState: v.optional(v.string()),
  usbRehomeAttempts: v.optional(v.union(v.number(), v.null())),
  usbRehomeLastResult: v.optional(v.union(v.string(), v.null())),
  installStatus: v.optional(v.string()),
  installVersion: v.optional(v.string()),
  failedSteps: v.optional(v.array(v.string())),
  cpuPercent: v.optional(v.number()),
  memoryPercent: v.optional(v.number()),
  diskPercent: v.optional(v.number()),
  temperature: v.optional(v.float64()),
  fcConnected: v.optional(v.boolean()),
  fcPort: v.optional(v.string()),
  fcBaud: v.optional(v.number()),
  // Gated MAVLink truth — siblings of fcConnected. transportOpen = the
  // serial/udp/tcp transport is open; mavlinkAlive = a HEARTBEAT was decoded
  // within the agent's freshness window; heartbeatAgeS = seconds since the
  // last one; fcSource = which source the router resolved; fcLinkHint = a
  // diagnostic hint for a not-alive link ("none" | "msp_detected" |
  // "no_heartbeat") that drives the GCS remediation message. All optional so
  // an agent that predates the gated truth round-trips cleanly.
  transportOpen: v.optional(v.boolean()),
  mavlinkAlive: v.optional(v.boolean()),
  heartbeatAgeS: v.optional(v.number()),
  fcSource: v.optional(v.string()),
  fcLinkHint: v.optional(v.string()),
  // FC protocol family the agent identified ("betaflight" | "inav" for an
  // MSP FC), so a cloud-relayed MSP FC drives the MSP adapter + MSP relay
  // lane the same way the LAN-direct path does. Optional so an agent that
  // predates the field round-trips cleanly.
  fcVariant: v.optional(v.string()),
  // Canonical FC firmware family ("ardupilot" | "px4" | "betaflight" | "inav")
  // so a cloud-relay GCS can badge the family, including ArduPilot vs PX4 which
  // fcVariant cannot distinguish. Optional for older agents.
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
  // Detailed memory breakdown: available, page-cache, and swap.
  memoryAvailableMb: v.optional(v.number()),
  memoryCacheMb: v.optional(v.number()),
  swapTotalMb: v.optional(v.number()),
  swapUsedMb: v.optional(v.number()),
  swapPercent: v.optional(v.number()),
  diskUsedGb: v.optional(v.number()),
  diskTotalGb: v.optional(v.number()),
  cpuCores: v.optional(v.number()),
  boardRamMb: v.optional(v.number()),
  // Process-level totals
  processCpuPercent: v.optional(v.number()),
  processMemoryMb: v.optional(v.number()),
  // History arrays for sparkline charts
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
};
