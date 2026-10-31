import { AgentClient } from "@/lib/agent/client";
import { relayRefusalFrom, type RelayRefusal } from "@/lib/agent/agent-client/transport";
import type { AgentStatus, LanStatusFull } from "@/lib/agent/types";
import { inferCapabilities } from "@/lib/agent/infer-capabilities";
import { useAgentSystemStore } from "../../agent-system-store";
import { useAgentPeripheralsStore } from "../../agent-peripherals-store";
import { useAgentPluginInventoryStore } from "../../agent-plugin-inventory-store";
import { useFleetNetworkStore } from "../../fleet-network-store";
import { useVideoStore } from "../../video-store";
import { resolveAgentWhepUrl } from "@/lib/video/rewrite-whep-host";
import { useAgentCapabilitiesStore } from "../../agent-capabilities-store";
import { useLocalNodesStore } from "../../local-nodes-store";
import { usePairingStore } from "../../pairing-store";
import { useCommandFleetStore } from "../../command-fleet-store";
import { probeAgent } from "@/lib/agent/local-pair-client";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { applyFullStatus } from "../apply-full-status";
import { nextPollDelay, POLL_BASE_MS, POLL_BASE_RELAY_MS } from "../poll-backoff";
import type {
  ClientManagerSlice,
  AgentConnectionSliceCreator,
  StalePairingInfo,
} from "../types";
import type { SliceGet, SliceSet } from "./connect";

// Module-level cleanup function for the tab visibility listener. Lives outside
// the store because Zustand's strict typing doesn't allow ad-hoc extra fields.
let _visibilityCleanup: (() => void) | undefined;

/** Body of the slice's `startPolling` action. */
export function startAgentPolling(set: SliceSet, get: SliceGet): void {
  get().stopPolling();

  // Track whether the consolidated endpoint is available (newer agents).
  // Once confirmed, skip the 4-request fallback path.
  let useFullEndpoint: boolean | null = null; // null = untried

  // The loop self-reschedules only after `poll` settles, so a slow/hung
  // poll can never overlap the next tick. `inFlight` is a second guard for
  // the immediate re-poll paths (tab-visibility) that fire `poll()`
  // outside the scheduler. `stopped` lets teardown halt rescheduling even
  // if a poll is mid-flight.
  let inFlight = false;
  let stopped = false;

  const poll = async () => {
    // Pause polling when browser tab is hidden to save bandwidth/battery.
    if (typeof document !== "undefined" && document.hidden) return;

    const client = get().client;
    if (!client) return;
    const pollNodeDeviceId = get().nodeDeviceId;

    /**
     * True when the connection this poll was started for is still the live
     * one.
     *
     * The awaits below can settle AFTER `disconnect()` or after the operator
     * switched nodes. Applying then resurrected `connected: true` on a
     * deliberately closed connection and filed the OLD agent's payload under
     * the NEW node's id.
     */
    const stillOurs = () =>
      get().client === client && get().nodeDeviceId === pollNodeDeviceId;

    // Drop overlapping invocations rather than stacking pending sockets.
    if (inFlight) return;
    inFlight = true;

    try {
      // Try consolidated endpoint first (1 request instead of 4).
      if (useFullEndpoint !== false) {
        // Time the request as the control-plane RTT surface. The LAN-direct
        // status round-trip is the cheapest always-available timing signal;
        // it is FC-independent (transport latency to the agent, not to the
        // flight controller). Cloud-relay mode has no client, so this only
        // ever runs on the LAN-direct path.
        const rttStart =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        // `getFullStatus` resolves null ONLY for an agent that predates the
        // endpoint; a timeout / relay 504 / network error throws. Treating a
        // throw as "unsupported" would latch the 4-request fallback on for
        // the connection's life on one lost datagram, so it stays a plain
        // failed poll and the next tick retries the consolidated endpoint.
        let full: LanStatusFull | null;
        try {
          full = await client.getFullStatus();
        } catch {
          if (stillOurs()) get().noteFetchFailure();
          return;
        }
        // The await settled; the connection may have been torn down or
        // re-pointed at another node while it was in flight.
        if (!stillOurs()) return;
        if (full) {
          const rttEnd =
            typeof performance !== "undefined" ? performance.now() : Date.now();
          get().setControlRttMs(Math.max(0, Math.round(rttEnd - rttStart)));
          useFullEndpoint = true;
          // Map consolidated response to the same stores as the 4-endpoint path.
          applyFullStatus(full, get().agentUrl, pollNodeDeviceId);
          get().noteFetchSuccess();
          return;
        }
        // The consolidated endpoint is one radio round trip; the fallback is
        // four concurrent ones on a half-duplex lane. Never trade down here —
        // retry the full endpoint on the next tick instead. The latch below
        // is deliberately left unset so that retry actually happens.
        if (get().relay) {
          get().noteFetchFailure();
          return;
        }
        // 404 or null = agent doesn't support it.
        useFullEndpoint = false;
      }

      // Fallback: parallel requests for older agents. Each fetcher swallows
      // its own error and reports whether it landed, so the tick's verdict is
      // "did anything come back" rather than the unconditional success the
      // self-catching promises used to imply — which reset the failure count
      // every tick and made the offline threshold unreachable.
      const results = await Promise.all([
        useAgentSystemStore.getState().fetchStatus(),
        useAgentSystemStore.getState().fetchServices(),
        useAgentSystemStore.getState().fetchResources(),
      ]);
      if (!stillOurs()) return;

      // Video status (may not exist on all agents). Under relay the
      // consolidated response already carries `full.video`, so this extra
      // round trip would only buy airtime contention.
      if (!get().relay && typeof client.getVideoStatus === "function") {
        client.getVideoStatus().then((video) => {
          if (!stillOurs()) return;
          if (video) {
            const deps = video.dependencies
              ? Object.fromEntries(
                  Object.entries(video.dependencies).map(([k, v]) => [k, { found: v.found }]),
                )
              : undefined;
            useVideoStore
              .getState()
              .setAgentVideoStatus(
                video.state,
                resolveAgentWhepUrl(video.whep_url, get().agentUrl),
                deps,
              );
          }
        }).catch(() => {});
      }
      if (results.some(Boolean)) get().noteFetchSuccess();
      else get().noteFetchFailure();
    } catch {
      get().noteFetchFailure();
    } finally {
      inFlight = false;
    }
  };

  // One scheduled tick: run the poll, then arm the next one from the
  // failure-derived delay. Self-rescheduling (vs a flat setInterval)
  // guarantees a slow poll never overlaps its successor and that a dead
  // host backs off instead of being hammered at the base cadence.
  const tick = async () => {
    if (stopped) return;
    await poll();
    if (stopped) return;
    const delay = nextPollDelay(
      get().consecutiveFailures,
      get().relay ? POLL_BASE_RELAY_MS : POLL_BASE_MS,
    );
    const handle = setTimeout(tick, delay);
    set({ pollInterval: handle });
  };

  // Run the first poll immediately, then let the loop self-reschedule.
  void tick();

  // Pause/resume on tab visibility change.
  if (typeof document !== "undefined") {
    const onVisibility = () => {
      if (!document.hidden) {
        // Tab became visible: poll immediately for fresh data. The
        // in-flight guard keeps this from doubling up with a tick.
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    // Store the cleanup function. Flipping `stopped` here too means a
    // pending in-flight poll can no longer arm a successor after teardown.
    _visibilityCleanup = () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  } else {
    // No document (SSR/Node): teardown still needs to stop rescheduling.
    _visibilityCleanup = () => {
      stopped = true;
    };
  }
}

/** Body of the slice's `stopPolling` action. */
export function stopAgentPolling(set: SliceSet, get: SliceGet): void {
  const { pollInterval } = get();
  if (pollInterval) {
    // The handle is a self-rescheduling setTimeout, not a setInterval.
    clearTimeout(pollInterval);
    set({ pollInterval: null });
  }
  // Clean up visibility listener and flip the loop's stop flag so a poll
  // mid-flight cannot arm the next tick after teardown.
  if (_visibilityCleanup) {
    _visibilityCleanup();
    _visibilityCleanup = undefined;
  }
}
