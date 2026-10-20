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
import { polygonArea } from "@/lib/drawing/geo-utils";
import { pointInPolygon } from "@/lib/geo/distance";
import { localFrameFor, navDistance } from "./local-geometry";
import { insetRing } from "./polygon-offset";

export function generatePerimeter(config: PerimeterConfig): PatternResult {
  const { polygon, offsetM, altitude, speed } = config;
  const empty: PatternResult = {
    waypoints: [],
    stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 },
  };
  if (polygon.length < 3) return empty;

  let path: [number, number][] = polygon;
  if (offsetM > 0) {
    const frame = localFrameFor(polygon);
    const inset = insetRing(polygon.map(([lat, lon]) => frame.toLocal(lat, lon)), offsetM);
    const geo = inset?.map((p) => frame.toGeo(p));
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
  const totalDistance = navDistance(waypoints);

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
