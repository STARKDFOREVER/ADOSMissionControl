/**
 * @module patterns/local-geometry
 * @description Flat local projection the pattern generators work in: lat/lon
 * to metres east/north of a reference point and back, plus the small vector
 * helpers the generators share. Good enough for areas under ~50 km.
 * @license GPL-3.0-only
 */

import { polygonCentroid } from "@/lib/drawing/geo-utils";
import { EARTH_RADIUS_M, haversineDistance, lonDelta, normalizeLon } from "@/lib/geo/distance";
import type { PatternWaypoint } from "./types";
import { isActionCommand } from "@/lib/mission/command-classes";
import type { WaypointCommand } from "@/lib/types";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** A point in local metres: x east, y north. */
export type XY = [number, number];

export interface LocalFrame {
  toLocal(lat: number, lon: number): XY;
  toGeo(p: XY): [number, number];
}

/**
 * A local frame centred on the centroid of `points`, taken with longitudes
 * unwrapped around the first point so a shape across 180° centres on itself.
 */
export function localFrameFor(points: readonly [number, number][]): LocalFrame {
  const firstLon = points[0][1];
  const [refLat, unwrappedRefLon] = polygonCentroid(
    points.map(([lat, lon]): [number, number] => [lat, firstLon + lonDelta(firstLon, lon)]),
  );
  const refLon = normalizeLon(unwrappedRefLon);
  const cosRef = Math.cos(refLat * DEG_TO_RAD);
  return {
    toLocal: (lat, lon) => [
      lonDelta(refLon, lon) * DEG_TO_RAD * EARTH_RADIUS_M * cosRef,
      (lat - refLat) * DEG_TO_RAD * EARTH_RADIUS_M,
    ],
    toGeo: ([x, y]) => [
      refLat + (y / EARTH_RADIUS_M) * RAD_TO_DEG,
      normalizeLon(refLon + (x / (EARTH_RADIUS_M * cosRef)) * RAD_TO_DEG),
    ],
  };
}

export function rotateXY([x, y]: XY, angle: number): XY {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}

export const distXY = (p: XY, q: XY): number => Math.hypot(q[0] - p[0], q[1] - p[1]);

export const lerpXY = (p: XY, q: XY, t: number): XY => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/** Length of an open polyline, metres. */
export function polylineLength(points: readonly XY[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distXY(points[i - 1], points[i]);
  return total;
}

/** Points every `spacing` metres along a polyline from its start, plus its end. */
export function pointsAlong(points: readonly XY[], spacing: number): XY[] {
  const out: XY[] = [points[0]];
  const total = polylineLength(points);
  let next = spacing;
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = distXY(points[i - 1], points[i]);
    while (seg > 0 && next <= walked + seg + 1e-9 && next < total - 1e-6) {
      out.push(lerpXY(points[i - 1], points[i], (next - walked) / seg));
      next += spacing;
    }
    walked += seg;
  }
  if (total > 1e-6) out.push(points[points.length - 1]);
  return out;
}

/** True for a row the vehicle flies to (not an action riding a waypoint). */
export function isNavRow(row: Pick<PatternWaypoint, "command">): boolean {
  return !isActionCommand((row.command || "WAYPOINT") as WaypointCommand);
}

/** Horizontal distance flown between the navigation rows, metres. */
export function navDistance(rows: readonly PatternWaypoint[]): number {
  let total = 0;
  let prev: PatternWaypoint | null = null;
  for (const row of rows) {
    if (!isNavRow(row)) continue;
    if (prev) total += haversineDistance(prev.lat, prev.lon, row.lat, row.lon);
    prev = row;
  }
  return total;
}
