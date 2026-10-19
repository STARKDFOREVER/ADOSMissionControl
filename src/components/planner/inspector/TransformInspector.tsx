/**
 * @module TransformInspector
 * @description Inspector body for whole-mission move, rotate, scale and mirror.
 * @license GPL-3.0-only
 */
"use client";

import { TransformPanel } from "../TransformPanel";

export function TransformInspector() {
  return (
    <div className="px-3 py-3">
      <TransformPanel />
    </div>
  );
}
