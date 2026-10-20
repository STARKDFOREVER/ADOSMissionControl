/**
 * @module patterns/corridor-generator
 * @description Generates a corridor scan: lines flown along the path's
 * center line, offset sideways to cover the corridor width.
 *
 * Algorithm:
 * 1. Project the center line to local metres
 * 2. Lay `n = max(1, ceil(width / spacing))` lines centred on the path, each
 *    the center line offset sideways with mitred joins (bevelled past a mitre
 *    limit of 4)
 * 3. Fly the lines in alternating direction through the shared capture-line
 *    emitter (turn-around overshoot and camera triggers, or hover-and-capture)
 *
 * @license GPL-3.0-only
 */

import type { CorridorConfig, PatternResult } from "./types";
import { assertPhotoCount, assertSpacing, assertTransectCount } from "./types";
import { polygonArea } from "@/lib/drawing/geo-utils";
import { localFrameFor, navDistance, polylineLength, type XY } from "./local-geometry";
import { offsetPolyline } from "./polygon-offset";
import { CaptureLineEmitter } from "./capture-line";

export function generateCorridor(config: CorridorConfig): PatternResult {
  const { pathPoints, corridorWidth, lineSpacing, altitude, speed } = config;
  const triggerDistance = config.cameraTriggerDistance ?? 0;
  const turn = config.turnAroundDistance ?? 0;

  if (pathPoints.length < 2 || corridorWidth <= 0 || lineSpacing <= 0) {
    return { waypoints: [], stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 } };
  }
  assertSpacing(lineSpacing, "line spacing");
  if (triggerDistance > 0) assertSpacing(triggerDistance, "trigger distance");

  const frame = localFrameFor(pathPoints);
  const center: XY[] = pathPoints.map(([lat, lon]) => frame.toLocal(lat, lon));
  if (polylineLength(center) <= 0) {
    return { waypoints: [], stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 } };
  }

  const lineCount = Math.max(1, Math.ceil(corridorWidth / lineSpacing - 1e-9));
  assertTransectCount(lineCount);

  const emitter = new CaptureLineEmitter(frame.toGeo);
  const previewLines: [[number, number], [number, number]][] = [];
  for (let i = 0; i < lineCount; i++) {
    // Left-most line first; offsets are symmetric about the center line.
    const offset = ((lineCount - 1) / 2 - i) * lineSpacing;
    const line = offsetPolyline(center, offset);
    const flown = i % 2 === 0 ? line : [...line].reverse();
    for (let k = 1; k < flown.length; k++) previewLines.push([frame.toGeo(flown[k - 1]), frame.toGeo(flown[k])]);
    emitter.line(flown, {
      altitude, speed, triggerDistance, turnStart: turn, turnEnd: turn,
      hoverAndCapture: config.hoverAndCapture,
    });
  }
  assertPhotoCount(emitter.photoCount);

  const half = corridorWidth / 2;
  const boundary = [...offsetPolyline(center, half), ...offsetPolyline(center, -half).reverse()].map((p) => frame.toGeo(p));
  const totalDistance = navDistance(emitter.rows);

  return {
    waypoints: emitter.rows,
    stats: {
      totalDistance,
      estimatedTime: speed > 0 ? totalDistance / speed : 0,
      photoCount: emitter.photoCount,
      coveredArea: polygonArea(boundary),
      transectCount: lineCount,
    },
    previewLines,
  };
}
