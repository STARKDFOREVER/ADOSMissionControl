/**
 * @module preflight-checklist-store
 * @description Which pre-flight checklist items the operator has ticked. Held
 * in a store, not in the checklist component, so the ticks survive the dock
 * collapsing or switching tabs, and the send dialog can read the same count.
 * Deliberately not persisted: a reload starts the checklist fresh.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { toggleItem, type CheckedMap } from "@/lib/preflight-checklist";

interface PreflightChecklistState {
  /** Ticked state keyed by item id. A missing key means unchecked. */
  checked: CheckedMap;
  /** Flip one item. */
  toggle: (id: string) => void;
  /** Untick every item. */
  clear: () => void;
}

export const usePreflightChecklistStore = create<PreflightChecklistState>()((set) => ({
  checked: {},
  toggle: (id) => set((s) => ({ checked: toggleItem(s.checked, id) })),
  clear: () => set({ checked: {} }),
}));
