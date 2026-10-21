/**
 * @module drag-math
 * @description Pure helpers for the planner 3D view's altitude drag: the
 * ground distance one screen pixel spans at a given camera distance, and the
 * altitude a vertical drag produces.
 * @license GPL-3.0-only
 */

import type { AltitudeFrame } from "@/lib/types";

/** Metres one screen pixel spans at `distanceM` from a perspective camera. */
export function metersPerPixel(distanceM: number, fovyRad: number, canvasHeightPx: number): number {
  return (2 * distanceM * Math.tan(fovyRad / 2)) / canvasHeightPx;
}

/**
 * Altitude after a vertical drag of `dyPx` screen pixels (positive is down, so
 * dragging up raises the waypoint). Rounded to 0.1 m. Relative and terrain
 * altitudes never go below the ground reference; absolute altitudes may.
 */
export function altitudeFromDrag(startAlt: number, dyPx: number, mpp: number, frame: AltitudeFrame): number {
  const alt = Math.round((startAlt - dyPx * mpp) * 10) / 10;
  if (frame === "absolute") return alt;
  return Math.max(0, alt);
}
