/**
 * The area a plan covers on the ground: its waypoints, planned home, geofence
 * and rally points, grown by a buffer so an offline map of it still shows the
 * vehicle drifting a little past the outermost point.
 *
 * @module geo/plan-bounds
 * @license GPL-3.0-only
 */

import type { PlannedHome, Waypoint } from "@/lib/types/mission";
import type { GeofenceSnapshot } from "@/stores/geofence-store";
import type { RallyPoint } from "@/stores/rally-store";

/** Geographic bounds in degrees. */
export interface PlanAreaBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** The fence geometry the plan area includes. */
export type PlanAreaFence = Pick<GeofenceSnapshot, "fenceType" | "circleCenter" | "circleRadius" | "polygonPoints" | "zones">;

/** Metres per degree of latitude (mean Earth radius 6,371,008.8 m). */
const M_PER_DEG_LAT = 111_195;

/**
 * Bounds of everything the plan places on the map, grown by `bufferM` metres
 * on every side. A circle (fence or zone) contributes its full extent. Returns
 * `null` when the plan places nothing.
 */
export function planAreaBounds(
  waypoints: readonly Pick<Waypoint, "lat" | "lon">[],
  plannedHome: PlannedHome | null | undefined,
  fence: PlanAreaFence | null | undefined,
  rally: readonly Pick<RallyPoint, "lat" | "lon">[],
  bufferM = 500,
): PlanAreaBounds | null {
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;

  /** Grow the box to hold a point plus `radiusM` around it; 0/0 means "here" on the wire, not a place. */
  const add = (lat: number, lon: number, radiusM = 0) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return;
    const dLat = radiusM / M_PER_DEG_LAT;
    const dLon = radiusM / (M_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6));
    north = Math.max(north, lat + dLat);
    south = Math.min(south, lat - dLat);
    east = Math.max(east, lon + dLon);
    west = Math.min(west, lon - dLon);
  };

  for (const w of waypoints) add(w.lat, w.lon);
  if (plannedHome) add(plannedHome.lat, plannedHome.lon);
  for (const r of rally) add(r.lat, r.lon);
  if (fence) {
    if (fence.fenceType === "polygon") for (const [lat, lon] of fence.polygonPoints) add(lat, lon);
    if (fence.fenceType === "circle" && fence.circleCenter && fence.circleRadius > 0) {
      add(fence.circleCenter[0], fence.circleCenter[1], fence.circleRadius);
    }
    for (const zone of fence.zones) {
      if (zone.type === "polygon") for (const [lat, lon] of zone.polygonPoints) add(lat, lon);
      else if (zone.circleCenter && zone.circleRadius > 0) add(zone.circleCenter[0], zone.circleCenter[1], zone.circleRadius);
    }
  }

  if (!Number.isFinite(north)) return null;

  // Buffer: latitude by a fixed step; longitude at the box edge nearest a
  // pole, where a degree is shortest, so the buffer is never short of `bufferM`.
  const dLat = bufferM / M_PER_DEG_LAT;
  const edgeLat = Math.min(89.9, Math.max(Math.abs(north), Math.abs(south)) + dLat);
  const dLon = bufferM / (M_PER_DEG_LAT * Math.cos((edgeLat * Math.PI) / 180));
  return {
    north: Math.min(90, north + dLat),
    south: Math.max(-90, south - dLat),
    east: Math.min(180, east + dLon),
    west: Math.max(-180, west - dLon),
  };
}
