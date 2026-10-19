/**
 * @module field-pack-store
 * @description Field tile packs: vector basemaps the paired ground station
 * serves over the LAN, so the map works with no internet. The chosen pack name
 * is persisted; where the packs are served from (`source`) is resolved live
 * from the paired ground agent each session and never persisted.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FieldTilePack } from "@/lib/agent/field-tile-packs";

export interface FieldTileSource {
  /** Agent origin, e.g. `http://ground.local:8080`. */
  baseUrl: string;
  apiKey: string;
  /** Every pack the agent reports, usable or not. */
  packs: FieldTilePack[];
}

interface FieldPackState {
  /** Name of the pack to render when the basemap is "field-pack", or null for the first usable one. */
  selectedPack: string | null;
  /** The paired ground station serving packs, or null when none is reachable. */
  source: FieldTileSource | null;
  setSelectedPack: (name: string | null) => void;
  setSource: (source: FieldTileSource | null) => void;
}

export const useFieldPackStore = create<FieldPackState>()(
  persist(
    (set) => ({
      selectedPack: null,
      source: null,
      setSelectedPack: (selectedPack) => set({ selectedPack }),
      setSource: (source) => set({ source }),
    }),
    {
      name: "altcmd:field-pack",
      version: 1,
      partialize: (s) => ({ selectedPack: s.selectedPack }),
    },
  ),
);

/** The pack to render: the chosen one when it is still usable, else the first usable one. */
export function activeFieldPack(source: FieldTileSource | null, selected: string | null): FieldTilePack | null {
  const usable = source?.packs.filter((p) => p.usable) ?? [];
  return usable.find((p) => p.name === selected) ?? usable[0] ?? null;
}
