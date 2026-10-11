"use client";

/**
 * @module use-cloud-status-watchdog
 * @description Heartbeat watchdog for the cloud status bridge. Surfaces a
 * reason when no status arrives within 15 s, then ticks every 5 s while the
 * page is visible: dims the agent as stale past STALE_THRESHOLD_MS and marks
 * it offline past OFFLINE_THRESHOLD_MS.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useVideoStore } from "@/stores/video-store";
import { STALE_THRESHOLD_MS, OFFLINE_THRESHOLD_MS } from "@/lib/agent/freshness";
import { describeMissingCloudStatus } from "@/lib/agent/cloud-status-diagnosis";

const STALE_CHECK_INTERVAL_MS = 5_000; // Check every 5s so the 1Hz UI label stays close to reality

export function useCloudStatusWatchdog(
  cloudDeviceId: string | null,
  convexAvailable: boolean,
): void {
  useEffect(() => {
    if (!cloudDeviceId || !convexAvailable) return;

    // Surface the reason if no cloud status has arrived within 15s. Silence on
    // the relay has several causes and only one of them is an offline agent: a
    // LAN-only node publishes nothing to the relay by design, and an agent with
    // its relay switched off never will either. Naming the wrong one sends the
    // operator to check power on a node that was never expected to report here.
    const timer = setTimeout(() => {
      const current = useAgentConnectionStore.getState();
      if (current.cloudMode && !useAgentSystemStore.getState().status) {
        useAgentConnectionStore.setState({
          connectionError: describeMissingCloudStatus(cloudDeviceId),
        });
      }
    }, 15000);

    // Ongoing staleness check: two thresholds.
    //   > STALE_THRESHOLD_MS  (45s) → mark system store stale, dim the UI,
    //                                 keep last-known data visible.
    //   > OFFLINE_THRESHOLD_MS (60s) → mark connection offline, clear MAVLink
    //                                  URL so dependent UIs stop trying.
    const tick = () => {
      const state = useAgentConnectionStore.getState();
      if (!state.cloudMode || !state.lastCloudUpdate) return;

      const elapsed = Date.now() - state.lastCloudUpdate;

      if (elapsed > STALE_THRESHOLD_MS) {
        const sys = useAgentSystemStore.getState();
        const patch: Record<string, unknown> = {};
        if (!sys.stale) patch.stale = true;
        // Keep the freshness clock in sync with the watchdog. If the user
        // hit Reconnect (which clears lastUpdatedAt to null) and no heartbeat
        // arrived before the grace period elapsed, seed lastUpdatedAt from
        // lastCloudUpdate so useFreshness() starts reporting the correct
        // stale/offline state instead of staying stuck at "unknown".
        if (sys.lastUpdatedAt == null && state.lastCloudUpdate != null) {
          patch.lastUpdatedAt = state.lastCloudUpdate;
        }
        if (Object.keys(patch).length > 0) {
          useAgentSystemStore.setState(patch);
        }
      }

      if (elapsed > OFFLINE_THRESHOLD_MS) {
        const seconds = Math.round(elapsed / 1000);
        const patch: Record<string, unknown> = {
          connectionError: `Agent offline (last seen ${seconds}s ago)`,
        };
        if (state.connected) patch.connected = false;
        if (state.mavlinkUrl) patch.mavlinkUrl = null;
        useAgentConnectionStore.setState(patch);
        // A silent agent is not streaming as far as anyone can prove.
        const video = useVideoStore.getState();
        if (video.agentVideoState !== "unknown") video.setAgentVideoStatus("unknown", null);
      }
    };

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(tick, STALE_CHECK_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId === null) return;
      clearInterval(intervalId);
      intervalId = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        tick();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimeout(timer);
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cloudDeviceId, convexAvailable]);
}
