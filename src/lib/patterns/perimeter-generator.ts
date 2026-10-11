/**
 * @module patterns/perimeter-generator
 * @description Generates a perimeter (boundary) loop: one closed pass around a
 * polygon, optionally offset inward by a fixed distance.
 *
 * Algorithm:
 * 1. Project the polygon to local XY meters around its centroid
 * 2. With an offset, shift every edge inward along its normal and intersect
 *    consecutive shifted edges to get the inset vertices
 * 3. Reject an offset that collapses the polygon (orientation flips or an
 *    inset vertex leaves the boundary)
 * 4. Emit the vertices in order and close the loop on the first one
 *
 * @license GPL-3.0-only
 */

import type { PatternResult, PatternWaypoint, PerimeterConfig } from "./types";
import { polygonArea, polygonCentroid } from "@/lib/drawing/geo-utils";
import { EARTH_RADIUS_M, haversineDistance, lonDelta, normalizeLon, pointInPolygon } from "@/lib/geo/distance";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

type XY = [number, number];

/** Twice the signed area of a local ring; positive when counter-clockwise. */
function signedArea2(ring: readonly XY[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return s;
}

/** Inset a simple ring by `d` meters; null when the inset degenerates. */
function insetRing(ring: readonly XY[], d: number): XY[] | null {
  const n = ring.length;
  const ccw = signedArea2(ring) > 0;
  // Shifted edge i as a point plus direction.
  const edges = ring.map((p, i) => {
    const q = ring[(i + 1) % n];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    // Left normal points inside a counter-clockwise ring.
    const nx = (ccw ? -dy : dy) / len;
    const ny = (ccw ? dx : -dx) / len;
    return { px: p[0] + nx * d, py: p[1] + ny * d, dx, dy };
  });
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const a = edges[(i - 1 + n) % n];
    const b = edges[i];
    const den = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(den) < 1e-9) {
      // Collinear neighbours: the shifted start point is the vertex.
      out.push([b.px, b.py]);
      continue;
    }
    const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den;
    out.push([a.px + a.dx * t, a.py + a.dy * t]);
  }
  if (Math.sign(signedArea2(out)) !== Math.sign(signedArea2(ring))) return null;
  // An inset past the polygon's inradius reverses edges even where the
  // overall orientation survives (a square inset past half its width).
  for (let i = 0; i < n; i++) {
    const a = out[i];
    const b = out[(i + 1) % n];
    if ((b[0] - a[0]) * edges[i].dx + (b[1] - a[1]) * edges[i].dy <= 0) return null;
  }
  return out;
}

export function generatePerimeter(config: PerimeterConfig): PatternResult {
  const { polygon, offsetM, altitude, speed } = config;
  const empty: PatternResult = {
    waypoints: [],
    stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 },
  };
  if (polygon.length < 3) return empty;

  let path: [number, number][] = polygon;
  if (offsetM > 0) {
    const firstLon = polygon[0][1];
    const [refLat, unwrappedRefLon] = polygonCentroid(
      polygon.map(([lat, lon]): [number, number] => [lat, firstLon + lonDelta(firstLon, lon)]),
    );
    const refLon = normalizeLon(unwrappedRefLon);
    const cosRef = Math.cos(refLat * DEG_TO_RAD);
    const local: XY[] = polygon.map(([lat, lon]) => [
      lonDelta(refLon, lon) * DEG_TO_RAD * EARTH_RADIUS_M * cosRef,
      (lat - refLat) * DEG_TO_RAD * EARTH_RADIUS_M,
    ]);
    const inset = insetRing(local, offsetM);
    const geo = inset?.map(([x, y]): [number, number] => [
      refLat + (y / EARTH_RADIUS_M) * RAD_TO_DEG,
      normalizeLon(refLon + (x / (EARTH_RADIUS_M * cosRef)) * RAD_TO_DEG),
    ]);
    if (!geo || geo.some((p) => !pointInPolygon(p, polygon))) {
      throw new Error(`perimeter offset ${offsetM} m collapses the boundary; reduce the offset`);
    }
    path = geo;
  }

  const waypoints: PatternWaypoint[] = [...path, path[0]].map(([lat, lon]) => ({
    lat,
    lon,
    alt: altitude,
    speed,
    command: "WAYPOINT",
  }));

  let totalDistance = 0;
  for (let i = 1; i < waypoints.length; i++) {
    totalDistance += haversineDistance(
      waypoints[i - 1].lat, waypoints[i - 1].lon,
      waypoints[i].lat, waypoints[i].lon,
    );
  }

  return {
    waypoints,
    stats: {
      totalDistance,
      estimatedTime: speed > 0 ? totalDistance / speed : 0,
      photoCount: 0,
      coveredArea: polygonArea(path),
      transectCount: 0,
    },
  };
}
