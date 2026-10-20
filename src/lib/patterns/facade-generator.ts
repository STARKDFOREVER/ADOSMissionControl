/**
 * @module patterns/facade-generator
 * @description Generates a facade (vertical) scan of one wall: a vertical
 * lawnmower in the plane parallel to the wall at a fixed distance.
 *
 * Algorithm:
 * 1. Offset the facade base line sideways by the scan distance, to the chosen
 *    side, to get the flight line
 * 2. Fly horizontal rows on that line from the bottom to the top altitude,
 *    at most `rowSpacing` apart, alternating direction
 * 3. Place a waypoint at every capture point along each row (or only the row
 *    ends with the camera off) and, before each waypoint, aim an ROI at the
 *    waypoint's perpendicular foot on the facade at the same altitude, so the
 *    camera faces the wall square-on as it reaches each point
 * 4. Level the gimbal once at the start
 *
 * @license GPL-3.0-only
 */

import type { FacadeConfig, PatternResult } from "./types";
import { assertPhotoCount, assertSpacing, assertTransectCount } from "./types";
import { distXY, localFrameFor, navDistance, pointsAlong, type XY } from "./local-geometry";
import { offsetPolyline } from "./polygon-offset";
import { CaptureLineEmitter } from "./capture-line";

const EMPTY: PatternResult = {
  waypoints: [],
  stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 },
};

/** Row altitudes from bottom to top, evenly spaced and no more than `spacing` apart. */
export function facadeRowAltitudes(bottom: number, top: number, spacing: number): number[] {
  const lo = Math.min(bottom, top);
  const hi = Math.max(bottom, top);
  const span = hi - lo;
  if (span <= 1e-6) return [lo];
  const gaps = Math.max(1, Math.ceil(span / spacing - 1e-9));
  return Array.from({ length: gaps + 1 }, (_, i) => lo + (span * i) / gaps);
}

export function generateFacade(config: FacadeConfig): PatternResult {
  const { pathPoints, side, distance, bottomAlt, topAlt, rowSpacing, cameraTriggerDistance, speed } = config;
  if (pathPoints.length < 2 || !(distance > 0)) return EMPTY;
  assertSpacing(rowSpacing, "row spacing");
  if (cameraTriggerDistance > 0) assertSpacing(cameraTriggerDistance, "trigger distance");

  const base = pathPoints.slice(0, 2);
  const frame = localFrameFor(base);
  const a = frame.toLocal(base[0][0], base[0][1]);
  const b = frame.toLocal(base[1][0], base[1][1]);
  const length = distXY(a, b);
  if (length <= 0) return EMPTY;

  // Positive offsets are to the left of a → b.
  const [fa, fb] = offsetPolyline([a, b], side === "left" ? distance : -distance);
  const ux = (b[0] - a[0]) / length;
  const uy = (b[1] - a[1]) / length;
  /** Foot of the perpendicular from a flight point onto the facade line. */
  const footOnFacade = (p: XY): XY => {
    const t = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
    return [a[0] + ux * t, a[1] + uy * t];
  };

  const rows = facadeRowAltitudes(bottomAlt, topAlt, rowSpacing);
  assertTransectCount(rows.length);
  // Waypoints at each capture point keep the ROI square to the wall; with the
  // camera off the row ends are enough.
  const flightLine = cameraTriggerDistance > 0 ? pointsAlong([fa, fb], cameraTriggerDistance) : [fa, fb];

  const emitter = new CaptureLineEmitter(frame.toGeo);
  emitter.action(fa, rows[0], speed, { command: "DO_MOUNT_CONTROL", param1: 0 });
  const previewLines: [[number, number], [number, number]][] = [];
  rows.forEach((alt, i) => {
    const row = i % 2 === 0 ? flightLine : [...flightLine].reverse();
    previewLines.push([frame.toGeo(row[0]), frame.toGeo(row[row.length - 1])]);
    emitter.line(row, {
      altitude: alt, speed, triggerDistance: cameraTriggerDistance, turnStart: 0, turnEnd: 0,
      hoverAndCapture: config.hoverAndCapture,
      beforeNav: (p, rowAlt) => {
        const [lat, lon] = frame.toGeo(footOnFacade(p));
        emitter.rows.push({ lat, lon, alt: rowAlt, speed, command: "ROI" });
      },
    });
  });
  assertPhotoCount(emitter.photoCount);

  const totalDistance = navDistance(emitter.rows);
  return {
    waypoints: emitter.rows,
    stats: {
      totalDistance,
      estimatedTime: speed > 0 ? totalDistance / speed : 0,
      photoCount: emitter.photoCount,
      coveredArea: 0,
      transectCount: rows.length,
    },
    previewLines,
  };
}
