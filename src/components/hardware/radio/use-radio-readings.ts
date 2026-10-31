"use client";

/**
 * @module hardware/radio/use-radio-readings
 * @description Resolves every radio reading the panel shows from the LAN poll and this node's cloud heartbeat row.
 * @license GPL-3.0-only
 */

import { useMemo, useRef } from "react";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { useClockStore } from "@/stores/clock-store";
import { useClockTick } from "@/lib/agent/freshness";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { cmdDroneStatusApi } from "@/lib/community-api-drones";
import type {
  RadioLinkState,
  RadioTopology,
  RadioPeerLink,
  RadioHopState,
  RadioAcquireState,
} from "@/lib/api/ground-station/types";
import { BROWNOUT_TX_FLOOR_DBM, DEFAULT_TX_MAX_DBM } from "./constants";
import {
  pickRadioFromCloud,
  pickReceiverFromCloud,
  resolveRadioSource,
} from "./cloud-radio";

export function useRadioReadings(
  hasAgent: boolean,
  nodeDeviceId: string | null,
  wfbTxPowerDbm: number | null,
) {
  const linkHealth = useGroundStationStore((s) => s.linkHealth);
  const lanFetchedAt = useGroundStationStore((s) => s.lastFetchedAt);
  // Staleness has to move on its own: a poll that stops landing must age the
  // card out without waiting for an unrelated re-render.
  useClockTick();
  const now = useClockStore((s) => s.now);

  const cloudStatuses = useConvexSkipQuery(cmdDroneStatusApi.listMyCloudStatuses, {
    enabled: hasAgent,
  });
  // Key the radio block to THIS node — the freshest cloud row anywhere could
  // belong to another node and render its link on this panel (no fabricated reading).
  const { radio: cloudRadioRow, hostname, updatedAt: cloudUpdatedAt } = useMemo(
    () => pickRadioFromCloud(cloudStatuses, nodeDeviceId),
    [cloudStatuses, nodeDeviceId],
  );

  // Calibration measurement source: the fleet node that is RECEIVING a peer's
  // downlink (reports a valid decode rate). The sweep runs on the connected
  // (transmit) agent; the score reads this receiver's decode-side stats. A ref
  // tracks the latest snapshot so the calibration loop reads fresh values
  // between heartbeats without re-rendering the wizard.
  const receiver = useMemo(() => pickReceiverFromCloud(cloudStatuses), [cloudStatuses]);
  const receiverName = receiver.hostname;
  const receiverRef = useRef(receiver);
  receiverRef.current = receiver;

  // Which source may speak. Local-first: the LAN poll is this node's own agent
  // answering at 2 Hz, and the cloud row is a heartbeat fan-out that keeps its
  // last value forever. A stale cloud row is not a reading, and it overrides a
  // shared value only when its own timestamp proves it is newer.
  const source = resolveRadioSource({ cloudUpdatedAt, lanFetchedAt, now });
  const cloudRadio = source.cloudFresh ? cloudRadioRow : null;
  const lan = source.lanFresh ? linkHealth : null;
  /** LAN-first pick for a reading both sources carry. */
  const shared = <T,>(
    lanValue: T | null | undefined,
    cloudValue: T | null | undefined,
  ): T | null =>
    source.cloudWinsShared
      ? (cloudValue ?? lanValue ?? null)
      : (lanValue ?? cloudValue ?? null);

  const linkState: RadioLinkState =
    source.cloudWinsShared && cloudRadio?.state
      ? (cloudRadio.state as RadioLinkState)
      : lan?.rssi_dbm != null
        ? "connected"
        : cloudRadio?.state
          ? (cloudRadio.state as RadioLinkState)
          : "disconnected";
  // Unknown until a fresh radio row reports it: no chip and no brownout
  // warning are raised on a guessed bus-powered topology.
  const topology: RadioTopology | null = cloudRadio?.topology
    ? (cloudRadio.topology as RadioTopology)
    : null;
  const rssiDbm = shared(lan?.rssi_dbm, cloudRadio?.rssiDbm);
  const bitrateMbps = shared(
    lan?.bitrate_mbps,
    cloudRadio?.bitrateKbps != null ? cloudRadio.bitrateKbps / 1000 : null,
  );
  const channel = shared(lan?.channel, cloudRadio?.channel);
  const freqMhz = cloudRadio?.freqMhz ?? null;
  const bandwidthMhz = cloudRadio?.bandwidthMhz ?? null;
  const fecRecovered = shared(lan?.fec_rec, cloudRadio?.fecRecovered);
  const fecLost = shared(lan?.fec_lost, cloudRadio?.fecLost);
  const driver = cloudRadio?.driver ?? null;
  const iface = cloudRadio?.iface ?? null;
  const snrDb = cloudRadio?.snrDb ?? null;
  const noiseDbm = cloudRadio?.noiseDbm ?? null;
  const lossPercent = cloudRadio?.lossPercent ?? null;
  const mcsIndex = cloudRadio?.mcsIndex ?? null;
  const rxSilentSeconds = cloudRadio?.rxSilentSeconds ?? null;
  const txVideoStalled = cloudRadio?.txVideoStalled ?? null;
  const txVideoStallKills = cloudRadio?.txVideoStallKills ?? null;
  // Selected WFB adapter surface. adapterInjectionOk === false means the
  // agent found no injection-capable adapter and refuses to transmit.
  const adapterChipset = cloudRadio?.adapterChipset ?? null;
  const adapterInjectionOk = cloudRadio?.adapterInjectionOk ?? null;
  const adapterUsbDegraded = cloudRadio?.adapterUsbDegraded ?? null;
  const adapterUsbSpeedMbps = cloudRadio?.adapterUsbSpeedMbps ?? null;
  const txPowerDbm = cloudRadio?.txPowerDbm ?? wfbTxPowerDbm;
  const txPowerMaxDbm = cloudRadio?.txPowerMaxDbm ?? DEFAULT_TX_MAX_DBM;

  // Live radio tuning surface (the running trio + adaptive state). Read-only
  // display values; the WfbTuningCard drives changes via onApply*.
  const fecK = cloudRadio?.fecK ?? null;
  const fecN = cloudRadio?.fecN ?? null;
  const adaptiveBitrateEnabled = cloudRadio?.adaptiveBitrateEnabled ?? null;
  const recommendedTierName = cloudRadio?.recommendedTierName ?? null;

  // Ground receive acquisition surface. acquireState / channelLocked
  // describe the channel-acquirer; reacquireKills counts destructive
  // ground wfb_rx restarts (a climbing value = thrashing receive link);
  // validRxPacketsPerS is the per-second valid WFB decode rate.
  const acquireState: RadioAcquireState | null =
    cloudRadio?.acquireState ?? null;
  const channelLocked = cloudRadio?.channelLocked ?? null;
  const reacquireKills = cloudRadio?.reacquireKills ?? null;
  const rxZombieKills = cloudRadio?.rxZombieKills ?? null;
  const validRxPacketsPerS = cloudRadio?.validRxPacketsPerS ?? null;

  // WFB link-diagnosis verdict + received-frame counters. Null when the
  // agent doesn't report them (older agents) so the card skips the chip
  // and the counter rows rather than fabricating a reading.
  const linkDiag = cloudRadio?.linkDiag ?? null;
  const packetsAll = cloudRadio?.packetsAll ?? null;
  const decryptErrors = cloudRadio?.decryptErrors ?? null;

  // Channel rendezvous + hop surface. Read-only: the agent owns
  // channel / band / reg-domain config and the hop supervisor decides
  // when to move. The card stays hidden when the agent reports none of
  // these (older agents).
  const homeChannel = cloudRadio?.homeChannel ?? null;
  const band = cloudRadio?.band ?? null;
  const regDomain = cloudRadio?.regDomain ?? null;
  const monitorActive = cloudRadio?.monitorActive ?? null;
  const txActive = cloudRadio?.txActive ?? null;
  const peerLink: RadioPeerLink | null = cloudRadio?.peerLink ?? null;
  const hopState: RadioHopState | null = cloudRadio?.hopState ?? null;
  const paired = cloudRadio?.paired ?? false;

  // "Paired — no video": the control link is up (paired and a peer has
  // been heard) but no valid WFB packets are decoding on the ground.
  // This is the operator's cue that the radio handshake succeeded yet
  // the video downlink isn't flowing. A non-zero decode rate means the
  // receive link is genuinely live.
  const pairedNoVideo =
    paired &&
    (peerLink === "linked" || acquireState === "locked") &&
    validRxPacketsPerS != null &&
    validRxPacketsPerS <= 0;

  // Brownout: VBUS topology + above 12 dBm. Agent firmware caps the
  // slider in hardware; this is just an informational pill.
  const showBrownoutWarning =
    topology === "host_vbus" &&
    txPowerDbm != null &&
    txPowerDbm > BROWNOUT_TX_FLOOR_DBM;

  return {
    hostname,
    receiverName,
    receiverRef,
    linkState,
    topology,
    rssiDbm,
    bitrateMbps,
    channel,
    freqMhz,
    bandwidthMhz,
    fecRecovered,
    fecLost,
    driver,
    iface,
    snrDb,
    noiseDbm,
    lossPercent,
    mcsIndex,
    rxSilentSeconds,
    txVideoStalled,
    txVideoStallKills,
    adapterChipset,
    adapterInjectionOk,
    adapterUsbDegraded,
    adapterUsbSpeedMbps,
    txPowerDbm,
    txPowerMaxDbm,
    fecK,
    fecN,
    adaptiveBitrateEnabled,
    recommendedTierName,
    acquireState,
    channelLocked,
    reacquireKills,
    rxZombieKills,
    validRxPacketsPerS,
    linkDiag,
    packetsAll,
    decryptErrors,
    homeChannel,
    band,
    regDomain,
    monitorActive,
    txActive,
    peerLink,
    hopState,
    paired,
    pairedNoVideo,
    showBrownoutWarning,
  };
}
