/**
 * @module node-sensors-store
 * @description One node's rig-sensor, clock, capture-storage, battery and
 * capture-session readings, as the Visor Overview and Sensors tabs show them.
 *
 * The readings are tagged with the node they describe (`nodeId`). A reader
 * rendered for another node treats the slice as unread, so a node switch
 * never paints the previous node's sensors under the new name. Each route is
 * read independently: a node that lacks one service still shows the others.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { BatteryHealth } from "@/lib/agent/schemas/battery";
import type {
  CaptureSessionSummary,
  ClockStatus,
  NodeSensorsApi,
  SensorsStatus,
  StorageStatus,
} from "@/lib/api/agent/sensors";

export interface NodeSensorsReadings {
  sensors: SensorsStatus | null;
  clock: ClockStatus | null;
  storage: StorageStatus | null;
  battery: BatteryHealth | null;
  /** Newest first. Null when the capture extension does not answer on the
   * node; undefined until read. */
  sessions: CaptureSessionSummary[] | null | undefined;
}

interface NodeSensorsState extends NodeSensorsReadings {
  /** The node the readings describe; null before the first load. */
  nodeId: string | null;
  /** Epoch ms of the last completed load; null before the first one. */
  fetchedAt: number | null;
  /** The first failure of the last load, for the operator; null when clean. */
  error: string | null;
  /** Read every route of `api` for `nodeId` and replace the slice. */
  load: (nodeId: string, api: NodeSensorsApi) => Promise<void>;
  /** Replace the slice wholesale (demo seed, tests). */
  setReadings: (nodeId: string, readings: NodeSensorsReadings) => void;
  clear: () => void;
}

const EMPTY: NodeSensorsReadings = {
  sensors: null,
  clock: null,
  storage: null,
  battery: null,
  sessions: undefined,
};

function settled<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === "fulfilled" ? r.value : null;
}

export const useNodeSensorsStore = create<NodeSensorsState>()((set) => ({
  ...EMPTY,
  nodeId: null,
  fetchedAt: null,
  error: null,

  load: async (nodeId, api) => {
    const results = await Promise.allSettled([
      api.getSensors(),
      api.getClock(),
      api.getStorage(),
      api.getBattery(),
      api.listCaptureSessions(),
    ] as const);
    const [sensors, clock, storage, battery, sessions] = results;
    // Every write is tagged with its node, so a late answer from a node the
    // operator left reads as unread under the new one, never as its data.
    const failed = results.find((r) => r.status === "rejected");
    set({
      nodeId,
      sensors: settled(sensors),
      clock: settled(clock),
      storage: settled(storage),
      battery: settled(battery),
      sessions: sessions.status === "fulfilled" ? sessions.value : undefined,
      fetchedAt: Date.now(),
      error: failed?.status === "rejected" ? String(failed.reason) : null,
    });
  },

  setReadings: (nodeId, readings) =>
    set({ ...readings, nodeId, fetchedAt: Date.now(), error: null }),

  clear: () => set({ ...EMPTY, nodeId: null, fetchedAt: null, error: null }),
}));
