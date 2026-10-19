/**
 * @module stores/ground-station/gnss-store
 * @description The GNSS lane of the ground station the GNSS tab is rendered
 * for: receivers, RTK base and heading. One snapshot, tagged with the agent
 * origin it was read from (`gnssFor`); a load for another origin resets it
 * first and a late answer from any other origin is dropped, so one ground
 * station's base never renders under another's name.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type {
  GnssBase,
  GnssBaseBody,
  GnssStatus,
  GroundStationApi,
} from "@/lib/api/ground-station-api";
import { AgentArmedRefusal } from "@/lib/agent/agent-client/transport";
import { errorMessage } from "./error-handler";

export interface GnssStoreState {
  gnss: GnssStatus | null;
  /** Agent origin `gnss` was read from; null for the demo seed. */
  gnssFor: string | null;
  error: string | null;
  fetchedAt: number | null;
  applying: boolean;
  load: (api: GroundStationApi) => Promise<void>;
  /** Resolves with the new base, or null on a failure recorded in `error`.
   * Rejects only with `AgentArmedRefusal`, which the caller answers. */
  applyBase: (api: GroundStationApi, body: GnssBaseBody) => Promise<GnssBase | null>;
  clear: () => void;
}

const INITIAL = {
  gnss: null,
  gnssFor: null,
  error: null,
  fetchedAt: null,
  applying: false,
} satisfies Partial<GnssStoreState>;

export const useGnssStore = create<GnssStoreState>((set, get) => ({
  ...INITIAL,

  load: async (api) => {
    const target = api.baseUrl;
    if (get().gnssFor !== target) set({ ...INITIAL, gnssFor: target });
    try {
      const gnss = await api.getGnss();
      if (get().gnssFor !== target) return;
      set({ gnss, error: null, fetchedAt: Date.now() });
    } catch (err) {
      if (get().gnssFor !== target) return;
      set({ error: errorMessage(err).message });
    }
  },

  applyBase: async (api, body) => {
    const target = api.baseUrl;
    set({ applying: true, error: null });
    try {
      const base = await api.setGnssBase(body);
      if (get().gnssFor !== target) return null;
      const gnss = get().gnss;
      set({ applying: false, gnss: gnss ? { ...gnss, base } : gnss });
      return base;
    } catch (err) {
      set({ applying: false });
      if (err instanceof AgentArmedRefusal) throw err;
      set({ error: errorMessage(err).message });
      return null;
    }
  },

  clear: () => set({ ...INITIAL }),
}));
