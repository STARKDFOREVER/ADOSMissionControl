/**
 * Transit altitude: the height above home a plan flies to and from its work
 * area. With a transit altitude set, the vehicle climbs to it at takeoff, flies
 * over to the first work waypoint at that height before descending to work, and
 * climbs back to it above the last work waypoint before the terminal RTL or
 * LAND. The planner model never stores the generated waypoints; every consumer
 * (statistics, simulation, upload, export) runs the plan through
 * {@link applyTransit} first.
 *
 * @module mission/transit
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types/mission";
import { isFlownCommand } from "@/lib/mission/command-classes";
import {
  inferHomeGroundElevation,
  waypointAltitudeAboveHome,
  type AltitudeDatums,
} from "@/lib/mission/altitude-frame";

const TAKEOFF_COMMANDS: Record<string, true> = { TAKEOFF: true, VTOL_TAKEOFF: true };
const TERMINAL_COMMANDS: Record<string, true> = { RTL: true, LAND: true, VTOL_LAND: true };

/**
 * The plan with the transit legs added. A no-op unless `transitAltM` is above
 * 0 and the plan starts with a TAKEOFF or VTOL_TAKEOFF.
 *
 * - The takeoff altitude rises to the transit altitude when it is lower.
 * - A `-transit-out` waypoint at the transit altitude is inserted at the first
 *   work waypoint's position, right before it.
 * - When the plan ends with RTL, LAND or VTOL_LAND, a `-transit-back` waypoint
 *   is inserted at the last work waypoint's position, right before that item.
 * - An insertion is skipped when the neighbouring work waypoint already flies
 *   at or above the transit altitude.
 *
 * `datums` resolves absolute and terrain frames to height above home; without
 * a home ground elevation those neighbours count as unknown, and the transit
 * waypoint is inserted.
 */
export function applyTransit(
  waypoints: Waypoint[],
  transitAltM: number | null,
  datums: AltitudeDatums = {},
): Waypoint[] {
  if (transitAltM === null || !(transitAltM > 0) || waypoints.length === 0) return waypoints;
  const first = waypoints[0];
  if (!TAKEOFF_COMMANDS[first.command ?? "WAYPOINT"]) return waypoints;

  const resolved: AltitudeDatums = {
    ...datums,
    homeGroundElevation: datums.homeGroundElevation ?? inferHomeGroundElevation(waypoints),
  };

  const out = waypoints.slice();
  const takeoffAbove = waypointAltitudeAboveHome(first, resolved);
  if (takeoffAbove !== null && takeoffAbove < transitAltM) {
    out[0] = { ...first, alt: first.alt + (transitAltM - takeoffAbove) };
  }

  // Work waypoints: flown points between the takeoff and the terminal item.
  const workIndexes: number[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const cmd = waypoints[i].command ?? "WAYPOINT";
    if (isFlownCommand(cmd) && !TAKEOFF_COMMANDS[cmd] && !TERMINAL_COMMANDS[cmd]) workIndexes.push(i);
  }
  if (workIndexes.length === 0) return out;
  const firstWork = workIndexes[0];
  const lastWork = workIndexes[workIndexes.length - 1];

  const needsTransit = (wp: Waypoint) => {
    const h = waypointAltitudeAboveHome(wp, resolved);
    return h === null || h < transitAltM;
  };
  const transitPoint = (at: Waypoint, suffix: string): Waypoint => ({
    id: `${first.id}-transit-${suffix}`,
    command: "WAYPOINT",
    frame: "relative",
    lat: at.lat,
    lon: at.lon,
    alt: transitAltM,
  });

  const lastIndex = waypoints.length - 1;
  const terminal = TERMINAL_COMMANDS[waypoints[lastIndex].command ?? "WAYPOINT"] === true && lastIndex > lastWork;
  // Insert the return leg first so the outbound index stays valid.
  if (terminal && needsTransit(waypoints[lastWork])) {
    out.splice(lastIndex, 0, transitPoint(waypoints[lastWork], "back"));
  }
  if (needsTransit(waypoints[firstWork])) {
    out.splice(firstWork, 0, transitPoint(waypoints[firstWork], "out"));
  }
  return out;
}
