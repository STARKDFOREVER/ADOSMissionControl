/**
 * @module stores/ground-station/adapter-rssi-history-store
 * @description Per-chain RSSI history for every WFB adapter a ground station
 * reports, keyed by node and interface, for the Radio tab's sparklines. Each
 * chain is a fixed-capacity `RingBuffer`, so the history is bounded however
 * long the tab stays open.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { RingBuffer } from "@/lib/ring-buffer";
import type { RadioAdapter } from "@/lib/api/ground-station/types";
import { keyedRecord } from "@/stores/drone-slices";

/** Samples kept per receive chain (one per adapter reading). */
export const RSSI_HISTORY_CAPACITY = 60;

/** iface → one ring per receive chain. */
export type AdapterRssiHistory = Record<string, RingBuffer<number>[]>;

interface AdapterRssiHistoryState {
  byNode: Record<string, AdapterRssiHistory>;
  /** Bumped on every recorded sample so selectors re-read the rings. */
  rev: number;
  /** Append one sample per chain of each adapter. A repeat of the last
   * recorded `adapters` array for the node is ignored, so re-renders that
   * carry the same reading never double-count it. */
  record: (nodeKey: string, adapters: readonly RadioAdapter[]) => void;
  clear: () => void;
}

const nodes = keyedRecord<AdapterRssiHistory>(() => ({}));

const lastRecorded = new Map<string, readonly RadioAdapter[]>();

export const useAdapterRssiHistoryStore = create<AdapterRssiHistoryState>((set, get) => ({
  byNode: {},
  rev: 0,
  record: (nodeKey, adapters) => {
    if (adapters.length === 0 || lastRecorded.get(nodeKey) === adapters) return;
    lastRecorded.set(nodeKey, adapters);
    const node: AdapterRssiHistory = { ...nodes.get(get().byNode, nodeKey) };
    for (const a of adapters) {
      const rings = node[a.iface] ?? [];
      a.rssi_dbm.forEach((v, chain) => {
        rings[chain] ??= new RingBuffer<number>(RSSI_HISTORY_CAPACITY);
        rings[chain].push(v);
      });
      node[a.iface] = rings;
    }
    set((s) => ({ byNode: nodes.set(s.byNode, nodeKey, node), rev: s.rev + 1 }));
  },
  clear: () => {
    lastRecorded.clear();
    set({ byNode: {}, rev: 0 });
  },
}));
