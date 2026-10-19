/**
 * @module BatchInspector
 * @description Inspector body for two or more selected waypoints.
 * @license GPL-3.0-only
 */
"use client";

import { usePlannerStore } from "@/stores/planner-store";
import { BatchEditor } from "../BatchEditor";

export function BatchInspector({ selectedIds }: { selectedIds: string[] }) {
  const clearMultiSelection = usePlannerStore((s) => s.clearMultiSelection);
  return (
    <div className="px-3 py-3">
      <BatchEditor selectedIds={selectedIds} onClearSelection={clearMultiSelection} />
    </div>
  );
}
