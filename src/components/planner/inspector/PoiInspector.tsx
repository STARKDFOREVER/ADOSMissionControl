/**
 * @module PoiInspector
 * @description Inspector body for points of interest. `focusId` selects,
 * highlights and scrolls to the row the outline pointed at.
 * @license GPL-3.0-only
 */
"use client";

import { PoiEditor } from "../PoiEditor";

export function PoiInspector({ focusId }: { focusId: string | null }) {
  return (
    <div className="px-3 py-3">
      <PoiEditor focusId={focusId} />
    </div>
  );
}
