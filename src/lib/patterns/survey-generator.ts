/**
 * @module patterns/survey-generator
 * @description Generates survey/grid (lawnmower) flight patterns from a polygon boundary.
 *
 * Algorithm:
 * 1. Rotate the polygon so lines at the grid angle (a compass bearing) run
 *    along the local x axis
 * 2. Lay `max(1, ceil(H / spacing))` scan lines centred across the rotated
 *    height H, so each edge strip is at most half a spacing and a narrow area
 *    still gets one centre line
 * 3. Clip each line to the boundary and split it around exclusion (keep-out)
 *    holes
 * 4. Order the lines serpentine from the entry corner; "alternate transects"
 *    flies every other line out and the skipped lines back in reverse, so every
 *    line is still flown
 * 5. Route every transit leg that would cross a keep-out hole around the hole
 * 6. Fly each line through the shared capture-line emitter (turn-around
 *    overshoot, camera triggers that shoot at both ends, or hover-and-capture)
 *
 * A second pass (crosshatch / tie lines) starts from where the first ended:
 * its line order is the one of the four corner orderings whose entry is
 * nearest, and the connecting leg is routed around keep-outs and counted in
 * the distance.
 *
 * @license GPL-3.0-only
 */

import type { SurveyConfig, PatternResult } from "./types";
import { assertPhotoCount, assertSpacing, assertTransectCount } from "./types";
import { polygonArea, polygonCentroid } from "@/lib/drawing/geo-utils";
import { haversineDistance, pointInPolygon } from "@/lib/geo/distance";
import { distXY, isNavRow, localFrameFor, navDistance, rotateXY, type XY } from "./local-geometry";
import { horizontalIntersections, routeAroundHoles, subtractHoleIntervals } from "./keep-out-routing";
import { CaptureLineEmitter } from "./capture-line";

const DEG_TO_RAD = Math.PI / 180;

/** Survey config plus optional keep-out rings (each a closed [lat, lon] ring) the transects must avoid. */
export type SurveyGenConfig = SurveyConfig & { exclusions?: [number, number][][] };

/**
 * A clipped transect span in rotated local space, tagged with whether each end
 * came from a hole edge (a clip) rather than the boundary. A hole-edge end must
 * never receive turn-around overshoot (it would push a waypoint into the keep-out).
 */
interface Transect {
  startX: number;
  endX: number;
  y: number;
  startClipped: boolean;
  endClipped: boolean;
}

const EMPTY: PatternResult = {
  waypoints: [],
  stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 },
};

/**
 * Order the transects: lines from the bottom or top, every piece of a line in
 * that line's direction, the direction alternating from line to line. With
 * `alternate`, every other line is flown first and the rest on the way back.
 */
function orderTransects(
  transects: readonly Transect[],
  fromTop: boolean,
  fromRight: boolean,
  alternate: boolean,
): Transect[] {
  const ys = [...new Set(transects.map((t) => t.y))].sort((a, b) => a - b);
  if (fromTop) ys.reverse();
  const lineYs = alternate && ys.length > 1
    ? [...ys.filter((_, i) => i % 2 === 0), ...ys.filter((_, i) => i % 2 === 1).reverse()]
    : ys;
  const ordered: Transect[] = [];
  lineYs.forEach((y, lineIndex) => {
    const pieces = transects
      .filter((t) => t.y === y)
      .sort((a, b) => Math.min(a.startX, a.endX) - Math.min(b.startX, b.endX));
    const ascending = (lineIndex % 2 === 0) !== fromRight;
    if (!ascending) pieces.reverse();
    for (const t of pieces) {
      const forward = t.startX <= t.endX;
      ordered.push(
        forward === ascending
          ? { ...t }
          : { startX: t.endX, endX: t.startX, y: t.y, startClipped: t.endClipped, endClipped: t.startClipped },
      );
    }
  });
  return ordered;
}

/** Internal single-pass survey generator; `from` is where the aircraft is when the pass starts. */
function generateSinglePass(config: SurveyGenConfig, from?: [number, number]): PatternResult {
  const {
    polygon, gridAngle, lineSpacing, turnAroundDistance, entryLocation,
    flyAlternateTransects, cameraTriggerDistance, altitude, speed, exclusions,
  } = config;

  if (polygon.length < 3 || lineSpacing <= 0) return EMPTY;
  assertSpacing(lineSpacing, "line spacing");
  if (cameraTriggerDistance > 0) assertSpacing(cameraTriggerDistance, "trigger distance");

  const frame = localFrameFor(polygon);
  // Lines at compass bearing B run at (90 - B)° counter-clockwise from east;
  // rotating by -(90 - B) lays them along the local x axis.
  const angleRad = -(90 - gridAngle) * DEG_TO_RAD;
  const toRotated = (lat: number, lon: number): XY => rotateXY(frame.toLocal(lat, lon), angleRad);
  const toGeoXY = (p: XY): [number, number] => frame.toGeo(rotateXY(p, -angleRad));

  const rotatedPoly = polygon.map(([lat, lon]) => toRotated(lat, lon));
  const rotatedExclusions: XY[][] = (exclusions ?? [])
    .filter((ring) => ring.length >= 3)
    .map((ring) => ring.map(([lat, lon]) => toRotated(lat, lon)));

  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of rotatedPoly) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Lines centred across the height: n lines, both edge strips equal and at
  // most half a spacing; an area thinner than one spacing gets a centre line.
  const height = maxY - minY;
  const lineCount = Math.max(1, Math.ceil(height / lineSpacing - 1e-9));
  assertTransectCount(lineCount);
  const firstY = minY + (height - (lineCount - 1) * lineSpacing) / 2;

  const transects: Transect[] = [];
  for (let i = 0; i < lineCount; i++) {
    const y = firstY + i * lineSpacing;
    const xs = horizontalIntersections(rotatedPoly, y);
    const holeIntervals: [number, number][] = [];
    for (const ex of rotatedExclusions) {
      const hxs = horizontalIntersections(ex, y);
      for (let h = 0; h + 1 < hxs.length; h += 2) holeIntervals.push([hxs[h], hxs[h + 1]]);
    }
    for (let k = 0; k + 1 < xs.length; k += 2) {
      if (holeIntervals.length === 0) {
        transects.push({ startX: xs[k], endX: xs[k + 1], y, startClipped: false, endClipped: false });
      } else {
        for (const p of subtractHoleIntervals(xs[k], xs[k + 1], holeIntervals)) {
          transects.push({ startX: p.start, endX: p.end, y, startClipped: p.startClipped, endClipped: p.endClipped });
        }
      }
    }
  }
  if (transects.length === 0) return EMPTY;

  const turnAt = (t: Transect, clipped: boolean) => (clipped ? 0 : turnAroundDistance);
  const entryOf = (t: Transect): XY => {
    const dir = t.endX >= t.startX ? 1 : -1;
    return [t.startX - dir * turnAt(t, t.startClipped), t.y];
  };

  // With a known start point, fly the corner ordering whose entry is nearest
  // to it; otherwise the operator's entry corner decides.
  const fromXY = from ? toRotated(from[0], from[1]) : null;
  let ordered: Transect[];
  if (fromXY) {
    const candidates = [false, true].flatMap((top) =>
      [false, true].map((right) => orderTransects(transects, top, right, flyAlternateTransects)));
    ordered = candidates.reduce((best, c) =>
      (distXY(entryOf(c[0]), fromXY) < distXY(entryOf(best[0]), fromXY) ? c : best));
  } else {
    const fromTop = entryLocation === "topLeft" || entryLocation === "topRight";
    const fromRight = entryLocation === "topRight" || entryLocation === "bottomRight";
    ordered = orderTransects(transects, fromTop, fromRight, flyAlternateTransects);
  }

  const emitter = new CaptureLineEmitter(toGeoXY, fromXY);
  const previewLines: [[number, number], [number, number]][] = [];
  const transit = (a: XY, b: XY) => routeAroundHoles(a, b, rotatedExclusions);
  for (const t of ordered) {
    const start: XY = [t.startX, t.y];
    const end: XY = [t.endX, t.y];
    previewLines.push([toGeoXY(start), toGeoXY(end)]);
    emitter.line([start, end], {
      altitude, speed, triggerDistance: cameraTriggerDistance,
      turnStart: turnAt(t, t.startClipped), turnEnd: turnAt(t, t.endClipped),
      hoverAndCapture: config.hoverAndCapture, transit,
    });
  }
  assertPhotoCount(emitter.photoCount);

  const waypoints = emitter.rows;
  const firstNav = waypoints.find(isNavRow);
  const connector = from && firstNav ? haversineDistance(from[0], from[1], firstNav.lat, firstNav.lon) : 0;
  const totalDistance = navDistance(waypoints) + connector;

  // Covered area is the boundary minus the keep-out holes inside it; an
  // exclusion drawn outside the survey area changes nothing.
  const exclusionArea = (exclusions ?? []).reduce((sum, ring) => {
    if (ring.length < 3) return sum;
    return pointInPolygon(polygonCentroid(ring), polygon) ? sum + polygonArea(ring) : sum;
  }, 0);

  return {
    waypoints,
    stats: {
      totalDistance,
      estimatedTime: speed > 0 ? totalDistance / speed : 0,
      photoCount: emitter.photoCount,
      coveredArea: Math.max(0, polygonArea(polygon) - exclusionArea),
      transectCount: ordered.length,
    },
    previewLines,
  };
}

/** Where a result's route ends, or undefined when it has no navigation row. */
export function routeExit(result: PatternResult): [number, number] | undefined {
  const last = result.waypoints.findLast(isNavRow);
  return last ? [last.lat, last.lon] : undefined;
}

/**
 * Generate a survey pattern. With crosshatch (or tie lines) a second pass at
 * gridAngle + 90 (or the tie angle) starts from where the first ended.
 * `from` is where the aircraft is before the survey (e.g. the previous area's exit).
 */
export function generateSurvey(config: SurveyGenConfig, from?: [number, number]): PatternResult {
  const firstPass = generateSinglePass(config, from);

  const hasTieLines = config.tieLines && !config.crosshatch;
  if (!config.crosshatch && !hasTieLines) return firstPass;

  // Tie lines: configurable angle and spacing; crosshatch: fixed 90 deg, same spacing
  const tieAngle = hasTieLines ? (config.tieLineAngle ?? 90) : 90;
  const tieSpacing = hasTieLines ? (config.tieLineSpacing ?? config.lineSpacing) : config.lineSpacing;

  const secondPass = generateSinglePass(
    { ...config, gridAngle: (config.gridAngle + tieAngle) % 360, lineSpacing: tieSpacing },
    routeExit(firstPass) ?? from,
  );

  return {
    waypoints: [...firstPass.waypoints, ...secondPass.waypoints],
    stats: {
      totalDistance: firstPass.stats.totalDistance + secondPass.stats.totalDistance,
      estimatedTime: firstPass.stats.estimatedTime + secondPass.stats.estimatedTime,
      photoCount: firstPass.stats.photoCount + secondPass.stats.photoCount,
      coveredArea: firstPass.stats.coveredArea, // Same polygon, counted once
      transectCount: firstPass.stats.transectCount + secondPass.stats.transectCount,
    },
    previewLines: [...(firstPass.previewLines ?? []), ...(secondPass.previewLines ?? [])],
  };
}
