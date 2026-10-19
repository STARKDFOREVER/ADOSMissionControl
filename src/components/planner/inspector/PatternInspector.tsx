/**
 * @module PatternInspector
 * @description Inspector body for the flight pattern editor.
 * @license GPL-3.0-only
 */
"use client";

import { PatternEditor } from "../PatternEditor";
import type { Planner } from "@/app/plan/use-planner";

export function PatternInspector({ p }: { p: Planner }) {
  return (
    <div className="px-3 py-3">
      <PatternEditor onApply={p.handlePatternApply} />
    </div>
  );
}
