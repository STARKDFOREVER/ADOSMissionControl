/**
 * @module stores/ground-station/lora-store
 * @description The LoRa lane of the ground station the LoRa tab is rendered
 * for: status + duty governor, the compiled region table and the beacons
 * heard. Tagged with the agent origin it was read from (`loraFor`) like the
 * mesh slice, so a late answer from another node is dropped. Beacons are
 * bounded to the agent's own cap.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type {
  GroundStationApi,
  LoraBeacon,
  LoraRegionPlan,
  LoraStatus,
  LoraUpdate,
} from "@/lib/api/ground-station-api";
import { AgentArmedRefusal } from "@/lib/agent/agent-client/transport";
import { errorMessage } from "./error-handler";

/** The agent returns at most this many beacons; never hold more. */
export const LORA_BEACONS_CAP = 100;

export interface LoraStoreState {
  status: LoraStatus | null;
  regions: LoraRegionPlan[] | null;
  beacons: LoraBeacon[];
  /** Agent origin the slice was read from; null for the demo seed. */
  loraFor: string | null;
  error: string | null;
  fetchedAt: number | null;
  applying: boolean;
  /** Status + governor, the fast poll. */
  load: (api: GroundStationApi) => Promise<void>;
  /** Beacons heard, the slow poll. */
  loadBeacons: (api: GroundStationApi) => Promise<void>;
  loadRegions: (api: GroundStationApi) => Promise<void>;
  /** Resolves with the new status, or null on a failure recorded in `error`.
   * Rejects only with `AgentArmedRefusal` (a region change while armed),
   * which the caller answers. */
  apply: (api: GroundStationApi, body: LoraUpdate) => Promise<LoraStatus | null>;
  clear: () => void;
}

const INITIAL = {
  status: null,
  regions: null,
  beacons: [],
  loraFor: null,
  error: null,
  fetchedAt: null,
  applying: false,
} satisfies Partial<LoraStoreState>;

export const useLoraStore = create<LoraStoreState>((set, get) => ({
  ...INITIAL,

  load: async (api) => {
    const target = api.baseUrl;
    if (get().loraFor !== target) set({ ...INITIAL, loraFor: target });
    try {
      const status = await api.getLora();
      if (get().loraFor !== target) return;
      set({ status, error: null, fetchedAt: Date.now() });
    } catch (err) {
      if (get().loraFor !== target) return;
      set({ error: errorMessage(err).message });
    }
  },

  loadBeacons: async (api) => {
    const target = api.baseUrl;
    // Beacons ride the status poll's origin; until it has claimed this node
    // there is nothing to attach them to.
    if (get().loraFor !== target || !get().status?.present) return;
    try {
      const { beacons } = await api.getLoraBeacons();
      if (get().loraFor !== target) return;
      set({ beacons: beacons.slice(0, LORA_BEACONS_CAP) });
    } catch (err) {
      if (get().loraFor !== target) return;
      set({ error: errorMessage(err).message });
    }
  },

  loadRegions: async (api) => {
    const target = api.baseUrl;
    try {
      const { regions } = await api.getLoraRegions();
      if (get().loraFor !== target) return;
      set({ regions });
    } catch (err) {
      if (get().loraFor !== target) return;
      set({ error: errorMessage(err).message });
    }
  },

  apply: async (api, body) => {
    const target = api.baseUrl;
    set({ applying: true, error: null });
    try {
      const status = await api.setLora(body);
      set({ applying: false });
      if (get().loraFor !== target) return null;
      set({ status, fetchedAt: Date.now() });
      return status;
    } catch (err) {
      set({ applying: false });
      if (err instanceof AgentArmedRefusal) throw err;
      set({ error: errorMessage(err).message });
      return null;
    }
  },

  clear: () => set({ ...INITIAL }),
}));
