"use client";

/**
 * @module visor/use-node-sensors
 * @description Polls one node's sensors, clock, storage, battery and capture
 * sessions into the node-sensors store and returns them, but only when the
 * store holds THIS node's readings. In demo the client is null, the poll
 * no-ops and the demo-seeded slice renders.
 * @license GPL-3.0-only
 */

import { useShallow } from "zustand/react/shallow";
import { useNodeDirectAgent } from "@/components/command/settings/use-node-direct-agent";
import { nodeSensorsApiFromAgent } from "@/lib/api/agent/sensors";
import { useNodeSensorsStore, type NodeSensorsReadings } from "@/stores/node-sensors-store";
import { useAgentPoll } from "../ground-station/use-gs-poll";

const POLL_MS = 3000;

export interface NodeSensorsView {
  /** False when no direct connection serves this node (cloud-only). */
  reachable: boolean;
  /** This node's readings, or null until one has been read. */
  readings: NodeSensorsReadings | null;
  error: string | null;
}

export function useNodeSensors(nodeDeviceId: string | null): NodeSensorsView {
  const direct = useNodeDirectAgent(nodeDeviceId);
  const load = useNodeSensorsStore((s) => s.load);
  useAgentPoll(
    direct?.agentUrl ?? null,
    direct?.apiKey ?? null,
    POLL_MS,
    async (api) => {
      if (nodeDeviceId) await load(nodeDeviceId, api);
    },
    nodeSensorsApiFromAgent,
  );
  const slice = useNodeSensorsStore(
    useShallow((s) => ({
      nodeId: s.nodeId,
      sensors: s.sensors,
      clock: s.clock,
      storage: s.storage,
      battery: s.battery,
      sessions: s.sessions,
      error: s.error,
    })),
  );
  const mine = nodeDeviceId !== null && slice.nodeId === nodeDeviceId;
  return {
    reachable: direct !== null,
    readings: mine
      ? {
          sensors: slice.sensors,
          clock: slice.clock,
          storage: slice.storage,
          battery: slice.battery,
          sessions: slice.sessions,
        }
      : null,
    error: mine ? slice.error : null,
  };
}
