/**
 * The mission a flying demo drone holds, and the operator download that puts it
 * in front of the Flight map.
 *
 * Every flying demo drone is in AUTO along its loop in `flight-paths`. A real
 * aircraft in AUTO is flying an uploaded mission and reports MISSION_CURRENT,
 * and the GCS maps that seq onto the open plan only when the plan is the one
 * the aircraft holds (an upload or download receipt). So each demo drone holds
 * its loop as a mission, the engine reports the item it is flying toward, and
 * selecting the drone runs the planner's own "Download from drone" store
 * action. The WP readout, the route on the Flight map and the PLAN overlay
 * then come off the same stores a real link feeds.
 *
 * @license GPL-3.0-only
 */

import type { MissionItem } from "@/lib/protocol/types";
import { speedItem } from "@/lib/mission/mission-expand";
import { missionContentHash } from "@/lib/mission-upload";
import { workspaceHasUnsavedChanges } from "@/lib/plan-workspace";
import { useMissionStore } from "@/stores/mission-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import type { PathWaypoint } from "./flight-paths";
import type { MockProtocol } from "./mock-protocol";

const MAV_CMD_NAV_WAYPOINT = 16;
const MAV_FRAME_GLOBAL = 0;
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;

/** Whether the firmware keeps home in seq 0 and the mission from seq 1. */
export function holdsHomeSlot(protocol: MockProtocol): boolean {
  return protocol.getVehicleInfo().firmwareType.startsWith("ardupilot-");
}

/**
 * The mission a demo loop is flown as: a NAV_WAYPOINT per path point and a
 * last one back on the first, so the route closes the loop the drone flies.
 * Each leg's speed rides a DO_CHANGE_SPEED where it changes, laid out exactly
 * as the planner writes one, so a download re-expands to these same items and
 * MISSION_CURRENT seqs map onto the right waypoint. With `homeSlot` the
 * ArduPilot layout: home (the loop start) at seq 0.
 */
export function pathMissionItems(path: readonly PathWaypoint[], homeSlot: boolean): MissionItem[] {
  const points = path.length > 1 ? [...path, path[0]] : [...path];
  const items: MissionItem[] = [];
  let seq = homeSlot ? 1 : 0;
  let speed: number | undefined;
  points.forEach((p, k) => {
    // The engine flies each leg at the speed of the point it leaves.
    const legSpeed = k === 0 ? p.speed : points[k - 1].speed;
    if (legSpeed !== speed) {
      items.push(speedItem(legSpeed, seq++, MAV_FRAME_GLOBAL_RELATIVE_ALT));
      speed = legSpeed;
    }
    items.push({
      seq: seq++,
      frame: MAV_FRAME_GLOBAL_RELATIVE_ALT,
      command: MAV_CMD_NAV_WAYPOINT,
      current: k === 0 ? 1 : 0,
      autocontinue: 1,
      param1: 0, param2: 0, param3: 0, param4: 0,
      x: Math.round(p.lat * 1e7),
      y: Math.round(p.lon * 1e7),
      z: p.alt,
    });
  });
  if (!homeSlot || path.length === 0) return items;
  const start = items.find((it) => it.command === MAV_CMD_NAV_WAYPOINT)!;
  return [{ ...start, seq: 0, frame: MAV_FRAME_GLOBAL, current: 0, z: 0 }, ...items];
}

/**
 * MISSION_CURRENT seq for the path point a demo drone is flying toward: the
 * seq of that point's NAV_WAYPOINT in {@link pathMissionItems}. Point 0 is
 * reached as the closing waypoint (the loop back to the start), so the active
 * waypoint advances 1, 2, … N and then starts over at 1.
 */
export function missionSeqForTarget(path: readonly PathWaypoint[], targetIdx: number, homeSlot: boolean): number {
  const nav = pathMissionItems(path, homeSlot)
    .filter((it) => it.command === MAV_CMD_NAV_WAYPOINT && it.frame !== MAV_FRAME_GLOBAL);
  return nav[targetIdx === 0 ? path.length : targetIdx].seq;
}

/**
 * Loads the selected demo drone's mission into the planner once per selection,
 * through the mission store's download (which records the receipt MISSION_CURRENT
 * is mapped against). It never replaces a plan carrying unsaved edits, except
 * one it loaded itself. The workspace is detached from the library plan it was
 * opened from first, so the library never saves a drone's route over that plan.
 */
export class DemoMissionLoader {
  private lastSelected: string | null = null;
  private loadedHash: string | null = null;
  private loading = false;

  /** Call every tick with the selection; acts only when it changes. */
  onSelection(selectedId: string | null, protocol: MockProtocol | null): Promise<void> | undefined {
    if (selectedId === this.lastSelected) return;
    this.lastSelected = selectedId;
    if (!selectedId || !protocol?.getCapabilities().supportsMissionDownload) return;
    return this.load();
  }

  private async load(): Promise<void> {
    const ownDownload =
      this.loading ||
      (this.loadedHash !== null &&
        missionContentHash(useMissionStore.getState().waypoints) === this.loadedHash);
    if (!ownDownload && workspaceHasUnsavedChanges()) return;
    usePlanLibraryStore.getState().setActivePlan(null);
    this.loading = true;
    try {
      const waypoints = await useMissionStore.getState().downloadMission();
      if (waypoints.length > 0) this.loadedHash = missionContentHash(waypoints);
    } finally {
      this.loading = false;
    }
  }
}
