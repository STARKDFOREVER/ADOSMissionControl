/**
 * @module mission/plan-home
 * @description Decides whether a vehicle-reported home belongs to the plan on
 * screen. A connected vehicle reports the home of the site it sits at; a plan
 * for another site must not route its return leg, datums or link-range check
 * through that point.
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import { isActionCommand } from "@/lib/mission/command-classes";
import { haversineDistance } from "@/lib/geo/distance";

/** A reported home farther than this from the plan's launch point belongs to another site. */
export const MAX_HOME_TO_PLAN_M = 50_000;

/** First item with a real position that the vehicle flies to: not an action, not RTL, not 0/0. */
export function planLaunchPoint(waypoints: readonly Waypoint[]): { lat: number; lon: number } | undefined {
  const wp = waypoints.find(
    (w) => !isActionCommand(w.command) && w.command !== "RTL" && !(w.lat === 0 && w.lon === 0),
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
