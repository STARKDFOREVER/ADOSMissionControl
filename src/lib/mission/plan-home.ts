/**
 * @module mission/plan-home
 * @description The plan's launch point, and whether a vehicle-reported home
 * belongs to the plan on screen. A connected vehicle reports the home of the
 * site it sits at; only a home near the plan may seed the plan's planned home.
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import { isFlownCommand } from "@/lib/mission/command-classes";
import { haversineDistance } from "@/lib/geo/distance";

/** A reported home farther than this from the plan's launch point belongs to another site. */
export const MAX_HOME_TO_PLAN_M = 50_000;

/**
 * First item the vehicle flies to that has a real position: not an action,
 * not DO_LAND_START (a marker the vehicle never flies to), not RTL, not an
 * item flown from wherever the vehicle is (0/0 or an inherited position).
 */
export function planLaunchPoint(waypoints: readonly Waypoint[]): { lat: number; lon: number } | undefined {
  const wp = waypoints.find(
    (w) => isFlownCommand(w.command) && w.command !== "RTL" && !w.inheritsPosition && !(w.lat === 0 && w.lon === 0),
  );
  return wp ? { lat: wp.lat, lon: wp.lon } : undefined;
}

/** True when `home` has no coordinates, the plan has no launch point, or the two are within {@link MAX_HOME_TO_PLAN_M}. */
export function isHomeNearPlan(home: { lat?: number; lon?: number }, waypoints: readonly Waypoint[]): boolean {
  if (home.lat === undefined || home.lon === undefined) return true;
  const launch = planLaunchPoint(waypoints);
  if (!launch) return true;
  return haversineDistance(home.lat, home.lon, launch.lat, launch.lon) <= MAX_HOME_TO_PLAN_M;
}
