/**
 * @module RallyInspector
 * @description Inspector body for rally points. `focusId` highlights and
 * scrolls to the row the outline pointed at.
 * @license GPL-3.0-only
 */
"use client";

import { RallyPointEditor } from "../RallyPointEditor";

export function RallyInspector({ focusId }: { focusId: string | null }) {
  return (
    <div className="px-3 py-3">
      <RallyPointEditor focusId={focusId} />
    </div>
  );
}
