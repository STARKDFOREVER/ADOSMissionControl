/**
 * @module AgentConnectionClientManagerSlice
 * @description Client lifecycle: AgentClient construction, polling loop with
 * tab-visibility pause, consolidated-endpoint preference with parallel
 * fallback, and full disconnect that clears every dependent store.
 *
 * The consolidated response's payload→store fan-out lives in
 * `./apply-full-status` and the poll-cadence math in `./poll-backoff`, so this
 * module is lifecycle and scheduling only.
 *
 * @license GPL-3.0-only
 */
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
import { connectAgent } from "./connect";
import { bumpGeneration } from "./generation";
import { startAgentPolling, stopAgentPolling } from "./polling";

export const clientManagerSlice: AgentConnectionSliceCreator<
  ClientManagerSlice
> = (set, get) => ({
  async connect(...args) {
    await connectAgent(set, get, ...args);
  },

  disconnect() {
    bumpGeneration();
    get().stopPolling();
    set({
      connected: false,
      client: null,
      agentUrl: null,
      apiKey: null,
      connectionError: null,
      cloudMode: false,
      cloudDeviceId: null,
      nodeDeviceId: null,
      mqttConnected: false,
      lastCloudUpdate: null,
      pollInterval: null,
      mavlinkUrl: null,
      consecutiveFailures: 0,
      stalePairing: null,
      mavlinkPairRequired: false,
      controlRttMs: null,
      relay: false,
      relayRefusal: null,
    });
    // Clear all other stores so a freshly-focused agent never shows the
    // previous one's data. Capabilities gate the radio/vision tabs and video
    // feeds the overview card, so both must reset on switch.
    useAgentSystemStore.getState().clear();
    useAgentPeripheralsStore.getState().clear();
    useAgentPluginInventoryStore.getState().clear();
    useFleetNetworkStore.getState().clear();
    useAgentCapabilitiesStore.getState().clear();
    useVideoStore.getState().setAgentVideoStatus("unknown", null);
  },

  startPolling() {
    startAgentPolling(set, get);
  },

  stopPolling() {
    stopAgentPolling(set, get);
  },

  clear() {
    get().disconnect();
  },
});
