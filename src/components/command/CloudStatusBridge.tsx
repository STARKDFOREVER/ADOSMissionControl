"use client";

/**
 * @module CloudStatusBridge
 * @description Bridges Convex cloud drone status into the agent Zustand stores.
 * Mounted when cloudMode is true. Reactively queries cmd_droneStatus and maps
 * to AgentStatus shape that the rest of the UI consumes.
 * Includes heartbeat staleness detection: dims as stale past
 * STALE_THRESHOLD_MS and marks the agent offline past OFFLINE_THRESHOLD_MS.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { unstable_batchedUpdates } from "react-dom";
import { useMutation, useConvexAuth } from "convex/react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useVideoStore } from "@/stores/video-store";
import { cmdDroneStatusApi, cmdDroneCommandsApi } from "@/lib/community-api-drones";
import { useConvexAvailable } from "@/hooks/use-convex-available";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { STALE_THRESHOLD_MS, OFFLINE_THRESHOLD_MS } from "@/lib/agent/freshness";
import {
  buildSystemUpdate,
  mapCloudStatus,
  resolveMavlinkUrl,
  resolveVideoUrls,
  resolveVideoStreams,
} from "./bridges/status-mapper";
import { useCloudStatusWatchdog } from "./use-cloud-status-watchdog";
import { applyCloudCapabilities, applyCloudInventoryFanout } from "./use-cloud-inventory-fanout";

export function CloudStatusBridge() {
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const setCloudStatus = useAgentConnectionStore((s) => s.setCloudStatus);
  const convexAvailable = useConvexAvailable();
  const initialLoadDone = useRef(false);

  const cloudStatus = useConvexSkipQuery(cmdDroneStatusApi.getCloudStatus, {
    args: { deviceId: cloudDeviceId! },
    enabled: !!cloudDeviceId,
  });

  const { isAuthenticated } = useConvexAuth();
  const enqueueCommand = useMutation(cmdDroneCommandsApi.enqueueCommand);

  // Heartbeat monitoring: initial timeout (15s) + staleness detection.
  useCloudStatusWatchdog(cloudDeviceId, convexAvailable);

  // Map Convex status to AgentStatus
  useEffect(() => {
    if (!cloudStatus) return;

    const cloudRecord = cloudStatus as Record<string, unknown>;
    const mapped = mapCloudStatus(cloudRecord);

    // One heartbeat fans out across the connection, system, peripherals,
    // fleet-network, ground-station, video and capabilities stores. Each Zustand
    // setState notifies its own subscribers synchronously, so without an
    // explicit batch a component reading two of these stores can render an
    // intermediate mix (new health, stale whepUrl). Coalesce every store
    // write below into a single flush so subscribers see one consistent
    // snapshot per heartbeat.
    unstable_batchedUpdates(() => {

    // Check if the data from Convex is actually fresh by comparing the
    // agent's last heartbeat timestamp against staleness thresholds.
    // The Convex reactive query returns the stored row regardless of age,
    // so we must check the data's own timestamp, not treat every query
    // response as proof the agent is alive.
    const dataAge = Date.now() - (cloudRecord.updatedAt as number);
    const isDataFresh = dataAge < STALE_THRESHOLD_MS;
    const isDataOffline = dataAge >= OFFLINE_THRESHOLD_MS;

    if (isDataFresh) {
      // Agent heartbeat is genuinely recent
      useAgentConnectionStore.setState({
        connected: true,
        connectionError: null,
      });
    } else if (isDataOffline) {
      // Data is older than the offline threshold
      const seconds = Math.round(dataAge / 1000);
      const label = seconds < 60
        ? `${seconds}s`
        : seconds < 3600
          ? `${Math.floor(seconds / 60)}m`
          : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
      useAgentConnectionStore.setState({
        connected: false,
        connectionError: `Agent offline (last heartbeat ${label} ago)`,
        mavlinkUrl: null,
      });
    }

    setCloudStatus(mapped, cloudRecord.updatedAt as number);

    // Single atomic update to system store — avoids multiple setState calls
    // that can cause React batching issues with stale intermediate states
    const systemUpdate = buildSystemUpdate(mapped, cloudRecord, isDataFresh);
    useAgentSystemStore.setState(systemUpdate);

    // Peripherals, peers, plugin inventory, ground station and plugin state.
    applyCloudInventoryFanout(cloudRecord, cloudDeviceId, isDataFresh);

    // Map video status from cloud heartbeat to video store
    // LAN fallback: when the agent's cloud heartbeat lags (or is broken
    // outright) the Convex row may not yet carry videoWhepUrl/lastIp. If
    // the cached pair record has an mDNS host (browser-local for LAN-only
    // pairings, Convex-mediated when signed in), we can still synthesize
    // a WHEP URL the cascade can attempt on the LAN. Prefers the
    // Convex-published URL when present (lets future out-of-LAN setups
    // still work).
    //
    // Gated on HTTP origin: on HTTPS the browser blocks plain-HTTP
    // fetches to a private LAN host (mixed content) so the synthesized
    // URLs would just produce confusing "Failed to fetch" errors. The
    // cascade prefers p2p-mqtt on HTTPS anyway, so skipping the LAN
    // synthesis is the right behaviour for HTTPS-served GCS pages.
    const allowLanSynthesis =
      typeof window === "undefined" ||
      window.location.protocol !== "https:";
    const localNode = allowLanSynthesis
      ? useLocalNodesStore
          .getState()
          .nodes.find((n) => n.deviceId === cloudDeviceId)
      : null;
    const pairedDrone = allowLanSynthesis
      ? usePairingStore
          .getState()
          .pairedDrones.find((d) => d.deviceId === cloudDeviceId)
      : null;
    const lastIp = cloudRecord.lastIp as string | undefined;
    // Prefer the agent's IPv4 over its `.local` mDNS name. Resolving a `.local`
    // host in the browser does IPv6/AAAA first and hangs ~5s when the box has
    // no usable IPv6, which blows the video-transport + MAVLink-WS connect
    // timeouts ("All transports failed"). The IPv4 connects instantly. mDNS is
    // kept only as a last resort for the rare case no IPv4 was captured.
    const lanHost =
      localNode?.ipv4 ||
      pairedDrone?.lastIp ||
      lastIp ||
      localNode?.mdnsHost ||
      pairedDrone?.mdnsHost ||
      null;

    const { state: videoState, whepUrl } = resolveVideoUrls(cloudRecord, lanHost);
    // Per-leg video streams for the cockpit stream switcher.
    const videoStreams = resolveVideoStreams(cloudRecord);
    // No reported video state means no advertised stream: nothing is dialed
    // until the heartbeat says what the node serves. A stale row proves no
    // stream at all, so its last state is not re-asserted.
    if (!isDataFresh) {
      useVideoStore.getState().setAgentVideoStatus("unknown", null);
    } else if (videoState) {
      useVideoStore.getState().setAgentVideoStatus(videoState, whepUrl);
    }

    // MAVLink WebSocket URL from agent heartbeat. The cascade dials this raw
    // proxy URL for any profile and attaches a ticket when a pairing key is
    // held, so there is no separate authenticated endpoint to resolve. Only a
    // fresh row republishes it; the offline branch above cleared it.
    const { url: mavlinkUrl } = resolveMavlinkUrl(cloudRecord, lanHost);
    if (isDataFresh && mavlinkUrl) {
      useAgentConnectionStore.getState().setMavlinkUrl(mavlinkUrl);
    }

    // Capabilities: first inference, or a forward-permissive re-merge.
    applyCloudCapabilities(mapped, cloudRecord, cloudDeviceId, videoStreams);
    });

    initialLoadDone.current = true;
  }, [cloudStatus, cloudDeviceId, setCloudStatus]);

  // Listen for cloud command events from the store
  useEffect(() => {
    if (!convexAvailable || !cloudDeviceId || !isAuthenticated) return;

    function handleCloudCommand(e: Event) {
      const detail = (e as CustomEvent).detail;
      enqueueCommand({
        deviceId: detail.deviceId,
        command: detail.command,
        args: detail.args,
      }).catch((err) => {
        console.warn("Cloud command enqueue failed:", err);
      });
    }

    window.addEventListener("cloud-command", handleCloudCommand);
    return () => window.removeEventListener("cloud-command", handleCloudCommand);
  }, [enqueueCommand, cloudDeviceId, convexAvailable, isAuthenticated]);

  return null; // Pure bridge, no UI
}
