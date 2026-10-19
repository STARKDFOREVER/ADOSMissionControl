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
import { GroundStationApiError } from "@/lib/api/ground-station/request";
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

export type NodeSensorsError = "refused" | "unreachable";

interface NodeSensorsState extends NodeSensorsReadings {
  /** The node the readings describe; null before the first load. */
  nodeId: string | null;
  /** Epoch ms of the last completed load; null before the first one. */
  fetchedAt: number | null;
  /** Why the last load lost a route, as an operator-facing kind: the node
   * answered with an error (`refused`) or did not answer (`unreachable`).
   * Null when every route answered. */
  error: NodeSensorsError | null;
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

/** The route's fresh answer, or — when that one read failed — the last good
 * reading of the same node, so one failing route never blanks a card. */
function settled<T>(r: PromiseSettledResult<T>, previous: T): T {
  return r.status === "fulfilled" ? r.value : previous;
}

/** Bumped by every load and every wholesale write; a load whose token is no
 * longer current lost a race (the operator switched nodes, or the slice was
 * replaced) and drops its answer. */
let loadSeq = 0;

export const useNodeSensorsStore = create<NodeSensorsState>()((set, get) => ({
  ...EMPTY,
  nodeId: null,
  fetchedAt: null,
  error: null,

  load: async (nodeId, api) => {
    const token = ++loadSeq;
    const results = await Promise.allSettled([
      api.getSensors(),
      api.getClock(),
      api.getStorage(),
      api.getBattery(),
      api.listCaptureSessions(),
    ] as const);
    const [sensors, clock, storage, battery, sessions] = results;
    if (token !== loadSeq) return;
    const failed = results.find((r) => r.status === "rejected");
    const prev = get();
    const same = prev.nodeId === nodeId;
    set({
      nodeId,
      sensors: settled(sensors, same ? prev.sensors : null),
      clock: settled(clock, same ? prev.clock : null),
      storage: settled(storage, same ? prev.storage : null),
      battery: settled(battery, same ? prev.battery : null),
      sessions: settled(sessions, same ? prev.sessions : undefined),
      fetchedAt: Date.now(),
      error:
        failed?.status !== "rejected"
          ? null
          : failed.reason instanceof GroundStationApiError
            ? "refused"
            : "unreachable",
    });
  },

  setReadings: (nodeId, readings) => {
    loadSeq += 1;
    set({ ...readings, nodeId, fetchedAt: Date.now(), error: null });
  },

  clear: () => {
    loadSeq += 1;
    set({ ...EMPTY, nodeId: null, fetchedAt: null, error: null });
  },
}));
