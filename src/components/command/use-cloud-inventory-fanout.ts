"use client";

/**
 * @module use-cloud-inventory-fanout
 * @description Store fan-out for one cloud status row: peripherals, mesh
 * peers, plugin inventory, ground-station and per-plugin cloud state, and the
 * capability snapshot (first inference or a forward-permissive re-merge).
 * Called by the cloud status bridge inside its single batched update so
 * subscribers see one consistent snapshot per heartbeat.
 * @license GPL-3.0-only
 */

import { useAgentPeripheralsStore } from "@/stores/agent-peripherals-store";
import {
  useAgentPluginInventoryStore,
  type AgentPluginInventoryEntry,
} from "@/stores/agent-plugin-inventory-store";
import { useFleetNetworkStore } from "@/stores/fleet-network-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { usePluginCloudStateStore } from "@/stores/plugin-cloud-state-store";
import {
  useAgentCapabilitiesStore,
  selectDeviceCapabilities,
} from "@/stores/agent-capabilities-store";
import { inferCapabilities } from "@/lib/agent/infer-capabilities";
import type { AgentStatus, NetworkPeer, PeripheralInfo } from "@/lib/agent/types";
import type { VideoStreamLeg } from "@/lib/agent/feature-types";
import { buildGroundStationPatch, buildHeartbeatExtras } from "./bridges/status-mapper";

/**
 * Fan the inventory-like fields of a cloud row out to their stores. Ground
 * station and plugin state only land from a fresh row.
 */
export function applyCloudInventoryFanout(
  cloudRecord: Record<string, unknown>,
  cloudDeviceId: string | null,
  isDataFresh: boolean,
): void {
  const peripherals = cloudRecord.peripherals;
  if (Array.isArray(peripherals)) {
    useAgentPeripheralsStore.setState({
      peripherals: peripherals as PeripheralInfo[],
    });
  }
  const peers = cloudRecord.peers;
  if (Array.isArray(peers)) {
    useFleetNetworkStore.setState({ peers: peers as NetworkPeer[] });
  }
  // Webapp-side plugin installs reported by the agent. Convex's
  // cmdPlugins:listForDevice stays authoritative; the inventory
  // store fills in installs the operator made directly from the
  // agent's local dashboard at port 8080.
  const inventory = cloudRecord.pluginInventory;
  if (Array.isArray(inventory) && cloudDeviceId) {
    useAgentPluginInventoryStore.getState().setForDevice(
      cloudDeviceId,
      inventory as AgentPluginInventoryEntry[],
    );
  }

  // Ground-station fan-out. Only writes when the
  // corresponding heartbeat field is present — LAN polls keep their
  // authority on every other field — and only from a fresh row: a stale
  // row's values would otherwise land as current readings.
  const gsState = useGroundStationStore.getState();
  const gsPatch = buildGroundStationPatch(cloudRecord, {
    linkHealth: gsState.linkHealth,
    status: gsState.status,
    role: gsState.role,
    uplink: gsState.uplink,
    peripherals: gsState.peripherals,
  }, (cloudRecord.updatedAt as number) ?? 0);
  if (isDataFresh && gsPatch) {
    useGroundStationStore.setState(gsPatch);
  }

  // Generic plugin-state fan-out: ferry each plugin's opaque slice
  // (pluginState[pluginId]) to the per-plugin cloud store, so ANY plugin's GCS
  // half reads its own cloud telemetry without a per-plugin core column.
  const pluginState = cloudRecord.pluginState;
  if (
    cloudDeviceId &&
    typeof pluginState === "object" &&
    pluginState !== null &&
    !Array.isArray(pluginState)
  ) {
    usePluginCloudStateStore
      .getState()
      .setForDevice(
        cloudDeviceId,
        pluginState as Record<string, Record<string, unknown>>,
        typeof cloudRecord.updatedAt === "number" ? cloudRecord.updatedAt : Date.now(),
      );
  }
}

/**
 * Build or re-merge the capability snapshot for this node from one cloud row.
 * Reads peripherals from the store, so call it after
 * {@link applyCloudInventoryFanout}.
 */
export function applyCloudCapabilities(
  mapped: AgentStatus,
  cloudRecord: Record<string, unknown>,
  cloudDeviceId: string | null,
  videoStreams: VideoStreamLeg[],
): void {
  // Capabilities from cloud status: compute from the agent's declared NPU
  // fields, cameras from peripherals. Read THIS node's remembered slice only:
  // a node with no slice yet is not loaded, so its first reading is built
  // fresh instead of merged over whichever node the operator has open.
  const capState = selectDeviceCapabilities(
    useAgentCapabilitiesStore.getState(),
    cloudDeviceId,
  );
  const extras = buildHeartbeatExtras(cloudRecord);

  // An empty camera list is a legitimate steady state (a ground station has
  // none), so it must not force a full re-infer on every tick — that made the
  // merge branch below dead code on any node with no cameras.
  if (!capState?.loaded) {
    const periphList = useAgentPeripheralsStore.getState().peripherals;
    const inferred = inferCapabilities(
      mapped,
      periphList,
      extras.inferOverrides,
      extras.profile,
    );
    if (inferred) {
      const payload: Record<string, unknown> = {
        ...inferred,
        videoRestartAttempts: extras.videoRestartAttempts,
        pairingCodeExpiresAt: extras.pairingCodeExpiresAt,
        wfbFailoverState: extras.wfbFailoverState,
        manualConnectionUrls: extras.manualConnectionUrls,
        cloudRelayUrl: extras.cloudRelayUrl,
        cloudflareUrl: extras.cloudflareUrl,
      };
      if (extras.setupState !== undefined) payload.setupState = extras.setupState;
      if (extras.profileSource !== undefined) payload.profileSource = extras.profileSource;
      if (extras.profile !== undefined) payload.profile = extras.profile;
      if (extras.role !== undefined) payload.role = extras.role;
      if (extras.runtimeMode !== undefined) payload.runtimeMode = extras.runtimeMode;
      if (extras.radioStackState !== undefined)
        payload.radioStackState = extras.radioStackState;
      if (extras.macStability !== undefined)
        payload.macStability = extras.macStability;
      if (extras.managementLink !== undefined)
        payload.managementLink = extras.managementLink;
      if (extras.wifiPowersave !== undefined)
        payload.wifiPowersave = extras.wifiPowersave;
      if (extras.mgmtLinkMode !== undefined) {
        payload.mgmtLinkMode = extras.mgmtLinkMode;
        payload.mgmtFailoverIface = extras.mgmtFailoverIface;
        payload.mgmtFailoverReason = extras.mgmtFailoverReason;
      }
      if (extras.usbRehomeState !== undefined) {
        payload.usbRehomeState = extras.usbRehomeState;
        payload.usbRehomeAttempts = extras.usbRehomeAttempts;
        payload.usbRehomeLastResult = extras.usbRehomeLastResult;
      }
      if (extras.radioRaw !== undefined) payload.radio = extras.radioRaw;
      if (extras.crsfRaw !== undefined) payload.crsf = extras.crsfRaw;
      payload.peerDeviceId = extras.peerDeviceId;
      payload.peerRole = extras.peerRole;
      payload.peerChannel = extras.peerChannel;
      payload.peerRssiDbm = extras.peerRssiDbm;
      payload.peerSeenAtUnix = extras.peerSeenAtUnix;
      payload.cameraState = extras.cameraState;
      if (extras.cameraUsbRecovery !== undefined)
        payload.cameraUsbRecovery = extras.cameraUsbRecovery;
      payload.videoStreams = videoStreams;
      if (extras.canBuses !== undefined) payload.canBuses = extras.canBuses;
      // Perception tier + offload target from the heartbeat (the normalizer
      // clamps the tier; null target = runs locally, undefined = keep prior).
      payload.perceptionTier = extras.perceptionTier;
      payload.perceptionOffloadTarget = extras.perceptionOffloadTarget;
      useAgentCapabilitiesStore
        .getState()
        .setCapabilities(payload, cloudDeviceId);
    }
  } else {
    // Capabilities are already loaded but several heartbeat-derived
    // fields change every tick: the radio block (TX power, RSSI,
    // FEC counters), the LCD live state (active page, last touch,
    // snapshot URL), and the local video tap (decoder fps,
    // recording flag). Re-merge the heartbeat-derived view of
    // those fields into the existing capability snapshot so the
    // normalizer fires without losing the deeper fields the agent
    // doesn't repeat every tick (cameras, compute, models).
    const periphList = useAgentPeripheralsStore.getState().peripherals;
    const reInferred = inferCapabilities(
      mapped,
      periphList,
      extras.inferOverrides,
      extras.profile,
    );
    const reInferredDisplay = reInferred?.display;
    const mergedDisplay = reInferredDisplay ?? capState.display;
    // Profile is exempt from the forward-permissive merge other fields
    // use. A profile is part of the node's identity, not a noisy live
    // metric: whenever the heartbeat carries the field at all we honor it
    // verbatim so a post-reboot profile change flips the tab tree on the
    // very next tick instead of being masked for a cycle by the cached
    // value. Only a heartbeat that omits the field entirely falls back to
    // what the store already had (so a sparse delta tick doesn't blank it).
    const profilePresent =
      Object.prototype.hasOwnProperty.call(cloudRecord, "profile");
    const reMergedProfile = profilePresent
      ? extras.profile
      : capState.profile;
    const rolePresent =
      Object.prototype.hasOwnProperty.call(cloudRecord, "role");
    const reMergedRole = rolePresent ? extras.role : capState.role;
    const reMergedRuntimeMode =
      extras.runtimeMode !== undefined
        ? extras.runtimeMode
        : capState.runtimeMode;
    const reMergedRadioStackState =
      extras.radioStackState !== undefined
        ? extras.radioStackState
        : capState.radioStackState;
    const reMergedMacStability =
      extras.macStability !== undefined
        ? extras.macStability
        : capState.macStability;
    const reMergedManagementLink =
      extras.managementLink !== undefined
        ? extras.managementLink
        : capState.managementLink;
    const reMergedWifiPowersave =
      extras.wifiPowersave !== undefined
        ? extras.wifiPowersave
        : capState.wifiPowersave;
    // The reach-back trio updates as a unit when the agent reports the mode;
    // a tick that omits it (stale sidecar) keeps the prior state.
    const reMergedMgmtLinkMode =
      extras.mgmtLinkMode !== undefined
        ? extras.mgmtLinkMode
        : capState.mgmtLinkMode;
    const reMergedMgmtFailoverIface =
      extras.mgmtLinkMode !== undefined
        ? extras.mgmtFailoverIface
        : capState.mgmtFailoverIface;
    const reMergedMgmtFailoverReason =
      extras.mgmtLinkMode !== undefined
        ? extras.mgmtFailoverReason
        : capState.mgmtFailoverReason;
    // The rehome trio updates as a unit when the agent reports the state.
    const reMergedUsbRehomeState =
      extras.usbRehomeState !== undefined
        ? extras.usbRehomeState
        : capState.usbRehomeState;
    const reMergedUsbRehomeAttempts =
      extras.usbRehomeState !== undefined
        ? extras.usbRehomeAttempts
        : capState.usbRehomeAttempts;
    const reMergedUsbRehomeLastResult =
      extras.usbRehomeState !== undefined
        ? extras.usbRehomeLastResult
        : capState.usbRehomeLastResult;
    useAgentCapabilitiesStore.getState().setCapabilities({
      tier: capState.tier,
      cameras: capState.cameras,
      // Latest heartbeat wins for the per-leg streams; a sparse tick that
      // resolves no legs keeps the prior set so the switcher doesn't flicker.
      videoStreams: videoStreams.length > 0 ? videoStreams : capState.videoStreams,
      // The agent declares its NPU on every heartbeat; a tick that omits the
      // declaration keeps the prior compute block.
      compute:
        reInferred && extras.inferOverrides?.npuTops !== undefined
          ? reInferred.compute
          : capState.compute,
      npuTops: extras.inferOverrides?.npuTops ?? undefined,
      hasAccelerator: extras.inferOverrides?.hasAccelerator ?? undefined,
      vision: capState.vision,
      models: capState.models,
      setupState: capState.setupState,
      profileSource: capState.profileSource,
      profile: reMergedProfile,
      role: reMergedRole,
      runtimeMode: reMergedRuntimeMode,
      radioStackState: reMergedRadioStackState,
      macStability: reMergedMacStability,
      managementLink: reMergedManagementLink,
      wifiPowersave: reMergedWifiPowersave,
      mgmtLinkMode: reMergedMgmtLinkMode,
      mgmtFailoverIface: reMergedMgmtFailoverIface,
      mgmtFailoverReason: reMergedMgmtFailoverReason,
      usbRehomeState: reMergedUsbRehomeState,
      usbRehomeAttempts: reMergedUsbRehomeAttempts,
      usbRehomeLastResult: reMergedUsbRehomeLastResult,
      display: mergedDisplay,
      // Effective primary local-display path. Latest heartbeat wins;
      // a sparse tick falls back to whatever the store already had so
      // the picker doesn't flicker to "Auto-detecting…" on every
      // heartbeat that omits the field.
      displayType: reInferred?.displayType ?? capState.displayType,
      videoLocalTap: reInferred?.videoLocalTap ?? capState.videoLocalTap,
      videoRecording: reInferred?.videoRecording ?? capState.videoRecording,
      uiTheme: reInferred?.uiTheme ?? capState.uiTheme,
      // Latest heartbeat wins for the air-side pipeline identity; if
      // the current tick omits it, fall back to whatever the store
      // already had so a sparse heartbeat doesn't blank the pill.
      // Latest heartbeat wins for the navigation block; sparse
      // heartbeats keep the prior value so flow / VIO indicators
      // don't flicker.
      navigation: reInferred?.navigation ?? capState.navigation,
      // Vision availability + live-detection summary. Latest
      // heartbeat wins; a sparse tick that omits the surface keeps
      // the prior value so the Vision tab and overlay don't flicker.
      visionAvailable: reInferred?.visionAvailable ?? capState.visionAvailable,
      visionSummary: reInferred?.visionSummary ?? capState.visionSummary,
      videoRestartAttempts: extras.videoRestartAttempts,
      pairingCodeExpiresAt: extras.pairingCodeExpiresAt,
      wfbFailoverState: extras.wfbFailoverState,
      manualConnectionUrls: extras.manualConnectionUrls,
      cloudRelayUrl: extras.cloudRelayUrl,
      cloudflareUrl: extras.cloudflareUrl,
      peerDeviceId: extras.peerDeviceId,
      peerRole: extras.peerRole,
      peerChannel: extras.peerChannel,
      peerRssiDbm: extras.peerRssiDbm,
      peerSeenAtUnix: extras.peerSeenAtUnix,
      cameraState: extras.cameraState,
      // Forward-permissive: undefined keeps whatever the store had so a
      // sparse tick that omits the recovery block doesn't blank it.
      cameraUsbRecovery: extras.cameraUsbRecovery,
      // Forward-permissive: undefined keeps whatever the store had,
      // matching the agent's "warmup window" semantics. Once the
      // FC param cache populates, every tick carries the latest
      // CAN bus snapshot.
      canBuses: extras.canBuses,
      // Perception tier + offload target: latest heartbeat wins; a tick that
      // omits them keeps the prior value (undefined) so the chip / tier card
      // don't flicker to "unknown" on a sparse tick.
      perceptionTier: extras.perceptionTier,
      perceptionOffloadTarget: extras.perceptionOffloadTarget,
      ...(extras.radioRaw !== undefined ? { radio: extras.radioRaw } : {}),
      ...(extras.crsfRaw !== undefined ? { crsf: extras.crsfRaw } : {}),
    } as Record<string, unknown>, cloudDeviceId);
  }
}
