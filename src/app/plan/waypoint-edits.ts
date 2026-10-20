/**
 * @module waypoint-edits
 * @description Pure edits the planner keyboard applies to a set of
 * waypoints: arrow-key nudge and clipboard paste.
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import { randomId } from "@/lib/utils";

/** Paste offset, degrees, so a pasted copy sits visibly beside the original. */
const PASTE_OFFSET_DEG = 0.0002;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Move the waypoints in `ids` by `dLat` degrees north and `dLonAtEquator`
 * degrees east as measured at the equator. A degree of longitude shrinks with
 * cos(latitude), so the east step is scaled up by it at the selection's mean
 * latitude: one press moves the same ground distance east as north, and a
 * multi-selection keeps its shape.
 */
export function nudgeWaypoints(
  waypoints: readonly Waypoint[],
  ids: readonly string[],
  dLat: number,
  dLonAtEquator: number,
): Waypoint[] {
  const moved = waypoints.filter((w) => ids.includes(w.id));
  if (moved.length === 0) return [...waypoints];
  const meanLat = moved.reduce((sum, w) => sum + w.lat, 0) / moved.length;
  // Near the poles cos(lat) tends to 0; the floor keeps one press bounded.
  const dLon = dLonAtEquator / Math.max(Math.cos(meanLat * DEG_TO_RAD), 0.01);
  return waypoints.map((w) => (ids.includes(w.id) ? { ...w, lat: w.lat + dLat, lon: w.lon + dLon } : w));
}

/**
 * Copies of clipboard waypoints ready to append to a plan: fresh ids, a small
 * offset, and no terrain sample (the copy sits over other ground). A DO_JUMP
 * into the copied set is pointed at the copy of its target; a DO_JUMP to a
 * waypoint outside the set is dropped, since the copy has no such target.
 */
export function pasteWaypoints(clip: readonly Waypoint[]): { waypoints: Waypoint[]; droppedJumps: number } {
  const newIds = new Map(clip.map((w) => [w.id, randomId()]));
  let droppedJumps = 0;
  const waypoints = clip.map(({ groundElevation: _moved, ...wp }) => {
    const copy: Waypoint = {
      ...wp,
      id: newIds.get(wp.id) as string,
      lat: wp.lat + PASTE_OFFSET_DEG,
      lon: wp.lon + PASTE_OFFSET_DEG,
    };
    if (!wp.actions) return copy;
    const actions = wp.actions.flatMap((action) => {
      const copied = { ...action, id: randomId() };
      if (copied.command !== "DO_JUMP" || copied.jumpTargetId === undefined) return [copied];
      const target = newIds.get(copied.jumpTargetId);
      if (target === undefined) {
        droppedJumps += 1;
        return [];
      }
      return [{ ...copied, jumpTargetId: target }];
    });
    return { ...copy, actions };
  });
  return { waypoints, droppedJumps };
}
