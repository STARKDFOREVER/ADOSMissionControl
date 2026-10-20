/**
 * @module structure-scan-generator
 * @description Generates a multi-layer structure scan: the structure outline
 * offset outward by the scan distance, flown once per altitude layer with the
 * camera pointed at the structure.
 *
 * Used for building inspection, cell tower inspection, bridge inspection, etc.
 *
 * Pure function: config in → waypoint array out.
 * @license GPL-3.0-only
 */

import type {
  PatternAltitudeSettings, PatternCameraSettings, PatternCaptureSettings, PatternResult,
} from "./types";
import { assertPhotoCount, assertSpacing } from "./types";
import { distXY, lerpXY, localFrameFor, navDistance, type XY } from "./local-geometry";
import { convexHull, insetRing } from "./polygon-offset";
import { CaptureLineEmitter } from "./capture-line";

export interface StructureScanConfig extends PatternAltitudeSettings, PatternCameraSettings, PatternCaptureSettings {
  /** Structure boundary polygon vertices [lat, lon] */
  structurePolygon: [number, number][];
  /** Bottom altitude of scan (meters above home, or above ground in the terrain modes) */
  bottomAlt: number;
  /** Top altitude of scan (meters above home, or above ground in the terrain modes) */
  topAlt: number;
  /** Vertical spacing between scan layers (meters) */
  layerSpacing: number;
  /** Horizontal distance from the structure's walls to the flight path (meters) */
  scanDistance: number;
  /** Gimbal pitch angle pointing inward (degrees, negative = down) */
  gimbalPitch: number;
  /** Points per layer along the flight path; every corner of the path is kept as well */
  pointsPerLayer: number;
  /** Camera trigger distance along the path (meters, 0 = disabled) */
  cameraTriggerDistance: number;
  /** Flight speed (m/s) */
  speed: number;
  /** Scan direction: bottom-up or top-down */
  direction: "bottom-up" | "top-down";
}

/**
 * Generate a multi-layer structure scan pattern.
 *
 * Algorithm:
 * 1. Offset the structure outline outward by `scanDistance` (its convex hull
 *    when a concave outline cannot be offset that far)
 * 2. Place points along that path: every corner, plus points spaced by
 *    perimeter / `pointsPerLayer`, closing on the start point
 * 3. For each altitude layer, fly the closed path; the camera trigger is armed
 *    after the first point and disarmed before each climb to the next layer
 * 4. The ROI at the structure centroid rides the first point, and every layer
 *    starts by commanding the gimbal pitch
 */
export function generateStructureScan(config: StructureScanConfig): PatternResult {
  const {
    structurePolygon, bottomAlt, topAlt, layerSpacing, scanDistance, gimbalPitch,
    pointsPerLayer, cameraTriggerDistance, speed, direction,
  } = config;

  if (structurePolygon.length < 3) {
    return { waypoints: [], stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 } };
  }
  assertSpacing(layerSpacing, "layer spacing");
  if (cameraTriggerDistance > 0) assertSpacing(cameraTriggerDistance, "trigger distance");

  const frame = localFrameFor(structurePolygon);
  const ring = structurePolygon.map(([lat, lon]) => frame.toLocal(lat, lon));
  const path = scanPath(ring, scanDistance, pointsPerLayer);
  const center = frame.toGeo(areaCentroid(ring));

  const altitudes: number[] = [];
  for (let alt = bottomAlt; alt < topAlt - 1e-6; alt += layerSpacing) altitudes.push(alt);
  altitudes.push(topAlt);
  if (direction === "top-down") altitudes.reverse();

  const emitter = new CaptureLineEmitter(frame.toGeo);
  altitudes.forEach((alt, layerIdx) => {
    // Alternate the direction round the structure from layer to layer; every
    // layer starts and ends on the same point, so the climb is vertical.
    const layer = layerIdx % 2 === 0 ? path : [...path].reverse();
    emitter.line(layer, {
      altitude: alt, speed, triggerDistance: cameraTriggerDistance, turnStart: 0, turnEnd: 0,
      hoverAndCapture: config.hoverAndCapture,
      afterFirstNav: (p) => {
        if (layerIdx === 0) {
          emitter.rows.push({ lat: center[0], lon: center[1], alt: (bottomAlt + topAlt) / 2, speed, command: "ROI" });
        }
        // After the ROI, so the ROI does not override the pitch.
        emitter.action(p, alt, speed, { command: "DO_MOUNT_CONTROL", param1: gimbalPitch });
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
      // A facade scan covers no ground area; 0 keeps the area row hidden.
      coveredArea: 0,
      transectCount: altitudes.length,
    },
  };
}

/**
 * The closed flight path `distance` metres outside the structure outline:
 * every corner, plus evenly spaced points so the path has about `points`
 * points, ending back on its first point.
 */
export function scanPath(ring: readonly XY[], distance: number, points: number): XY[] {
  const outline = insetRing(ring, -Math.max(0, distance)) ?? insetRing(convexHull(ring), -Math.max(0, distance)) ?? [...ring];
  const closed = [...outline, outline[0]];
  let perimeter = 0;
  for (let i = 1; i < closed.length; i++) perimeter += distXY(closed[i - 1], closed[i]);
  const step = perimeter / Math.max(3, points);
  const out: XY[] = [];
  for (let i = 1; i < closed.length; i++) {
    const a = closed[i - 1];
    const b = closed[i];
    out.push(a);
    const pieces = Math.max(1, Math.round(distXY(a, b) / step));
    for (let k = 1; k < pieces; k++) out.push(lerpXY(a, b, k / pieces));
  }
  out.push(closed[0]);
  return out;
}

/**
 * Area centroid of a local ring. A plain vertex average drifts toward
 * whichever side was digitised with more points; the area centroid does not.
 * Falls back to the vertex average for a degenerate (zero-area) ring.
 */
function areaCentroid(ring: readonly XY[]): XY {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const cross = ax * by - bx * ay;
    twiceArea += cross;
    cx += (ax + bx) * cross;
    cy += (ay + by) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) {
    return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  }
  return [cx / (3 * twiceArea), cy / (3 * twiceArea)];
}
