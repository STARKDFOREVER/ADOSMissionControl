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

/** One route of the slice. */
export type NodeSensorsRoute = keyof NodeSensorsReadings;

/** Epoch ms each route's shown value was actually read; null when never. */
export type NodeSensorsReadAt = Record<NodeSensorsRoute, number | null>;

interface NodeSensorsState extends NodeSensorsReadings {
  /** The node the readings describe; null before the first load. */
  nodeId: string | null;
  /** Epoch ms of the last completed load; null before the first one. A route
   * whose `readAt` is older failed on that load and shows a kept value. */
  fetchedAt: number | null;
  /** When each route's shown value was read. A failed route keeps the same
   * node's last good value with its ORIGINAL read time, never a fresh one. */
  readAt: NodeSensorsReadAt;
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

const NEVER_READ: NodeSensorsReadAt = {
  sensors: null,
  clock: null,
  storage: null,
  battery: null,
  sessions: null,
};

function readAtAll(at: number): NodeSensorsReadAt {
  return { sensors: at, clock: at, storage: at, battery: at, sessions: at };
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
  readAt: NEVER_READ,

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
    const now = Date.now();
    // A route that answered is fresh as of now; one that failed keeps the
    // same node's last good value AND the time that value was read, so a
    // surface can mark it stale instead of passing it off as current.
    const pick = <T,>(route: NodeSensorsRoute, r: PromiseSettledResult<T>, kept: T, none: T) => {
      if (r.status === "fulfilled") return { value: r.value, at: now };
      return same ? { value: kept, at: prev.readAt[route] } : { value: none, at: null };
    };
    const s = pick("sensors", sensors, prev.sensors, null);
    const c = pick("clock", clock, prev.clock, null);
    const st = pick("storage", storage, prev.storage, null);
    const b = pick("battery", battery, prev.battery, null);
    const se = pick("sessions", sessions, prev.sessions, undefined);
    set({
      nodeId,
      sensors: s.value,
      clock: c.value,
      storage: st.value,
      battery: b.value,
      sessions: se.value,
      readAt: { sensors: s.at, clock: c.at, storage: st.at, battery: b.at, sessions: se.at },
      fetchedAt: now,
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
    const now = Date.now();
    set({ ...readings, nodeId, fetchedAt: now, readAt: readAtAll(now), error: null });
  },

  clear: () => {
    loadSeq += 1;
    set({ ...EMPTY, nodeId: null, fetchedAt: null, readAt: NEVER_READ, error: null });
  },
}));
