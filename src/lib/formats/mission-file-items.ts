/**
 * @module formats/mission-file-items
 * @description Shared rules for reading and writing MAVLink mission items as
 * text (`.waypoints` rows, `.plan` SimpleItems): how x/y are written, which
 * items must carry an altitude, where the file's planned home is, and how
 * mission-start items that come before the first waypoint are kept.
 *
 * @license GPL-3.0-only
 */

import type { MissionItem } from "@/lib/protocol/types/mission";
import type { PlannedHome, WaypointCommand } from "@/lib/types";
import { reverseCmd } from "@/lib/mission/command-map";
import { isNavCommand } from "@/lib/mission/command-classes";
import { isFoldableSpeedItem, itemCarriesLocation } from "@/lib/mission/mission-expand";

/** Text-file value of an item's x/y: degrees for a location, else the raw parameter. */
export function fileXY(item: MissionItem): [number, number] {
  return itemCarriesLocation(item.command) ? [item.x / 1e7, item.y / 1e7] : [item.x, item.y];
}

/**
 * Wire x/y from a text-file param5/param6 pair (inverse of {@link fileXY}).
 * A non-location NaN stays NaN: MAVLink uses NaN as "leave unchanged" there.
 */
export function wireXY(command: number, p5: number, p6: number): [number, number] {
  return itemCarriesLocation(command)
    ? [Math.round(p5 * 1e7), Math.round(p6 * 1e7)]
    : [Number.isFinite(p5) ? Math.round(p5) : p5, Number.isFinite(p6) ? Math.round(p6) : p6];
}

/**
 * True when the item's altitude is flown: a navigation command other than RTL
 * (which returns at the vehicle's own return altitude) and DO_LAND_START
 * (a marker the vehicle never flies to).
 */
export function carriesAltitude(command: number): boolean {
  const known: WaypointCommand | undefined = reverseCmd[command];
  return known !== undefined && isNavCommand(known) && known !== "RTL" && known !== "DO_LAND_START";
}

/**
 * Throw on the first item whose flown altitude is missing. A missing altitude
 * is never 0: QGC writes `null` for a "calculated above terrain" item until it
 * has terrain data, and 0 m above sea level flies the vehicle into the ground.
 */
export function assertAltitudes(items: readonly MissionItem[]): void {
  for (const item of items) {
    if (carriesAltitude(item.command) && !Number.isFinite(item.z)) {
      throw new Error(
        `Item ${item.seq} has no altitude (calculated-above-terrain plans need QGC to fill altitudes first)`,
      );
    }
  }
}

/**
 * The planned home a file names, or undefined for the `0,0` placeholder.
 * A home altitude of 0 is what a GCS writes when it has no ground height, so
 * it is read as "ground unknown" rather than as sea level.
 */
export function plannedHomeFromFile(lat: number, lon: number, alt: number): PlannedHome | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return undefined;
  return Number.isFinite(alt) && alt !== 0 ? { lat, lon, groundAmsl: alt } : { lat, lon };
}

/**
 * Reorder mission-start items so none is lost. QGC writes the mission's
 * flight speed and camera settings ahead of the first waypoint, where the
 * planner model has no waypoint for them to ride. A leading speed change of
 * the shape the planner folds stays in front, so it becomes the first
 * waypoint's speed; every other leading item moves behind the first
 * navigation item and attaches to it as an action. Each item keeps its `seq`,
 * so DO_JUMP targets resolve exactly as written.
 */
export function attachLeadingItems(items: readonly MissionItem[]): MissionItem[] {
  const firstNav = items.findIndex((item) => {
    const known: WaypointCommand | undefined = reverseCmd[item.command];
    return known !== undefined && isNavCommand(known);
  });
  if (firstNav <= 0) return [...items];
  const leading = items.slice(0, firstNav);
  return [
    ...leading.filter(isFoldableSpeedItem),
    items[firstNav],
    ...leading.filter((item) => !isFoldableSpeedItem(item)),
    ...items.slice(firstNav + 1),
  ];
}
