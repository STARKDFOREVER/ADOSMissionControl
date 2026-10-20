/**
 * Resume mission: the mission a fresh battery flies to pick a plan up where
 * the previous pack left off, the way QGroundControl's Resume Mission builds
 * it. The vehicle takes off, flies to the waypoint before the resume point
 * with the speed and camera trigger that were in effect there restored, and
 * continues with the rest of the plan unchanged.
 *
 * @module mission/resume
 * @license GPL-3.0-only
 */

import type { CommandMissionAction, PlanVehicleClass, Waypoint } from "@/lib/types/mission";

const TAKEOFF_COMMANDS: Record<string, true> = { TAKEOFF: true, VTOL_TAKEOFF: true };

/** DO_CHANGE_SPEED speed type: airspeed (fixed wing), else ground speed. */
const SPEED_TYPE_AIRSPEED = 0;
const SPEED_TYPE_GROUND = 1;
/** DO_CHANGE_SPEED throttle value meaning "leave the throttle unchanged". */
const THROTTLE_NO_CHANGE = -1;

export interface ResumeDefaults {
  /** Height above home a synthesized TAKEOFF climbs to when the plan has none. */
  takeoffAltM: number;
  /** The mission default speed. */
  speedMps: number;
  /** Decides the speed type of the restored speed; multirotor when absent. */
  vehicleClass?: PlanVehicleClass;
}

/**
 * The speed the vehicle flies when it leaves `waypoints[resumeIndex - 1]`,
 * following the upload's speed model: a waypoint's own speed governs the leg
 * into it, an attached DO_SET_SPEED holds until a later waypoint sets its own,
 * and otherwise the mission default applies.
 */
function speedInEffect(waypoints: readonly Waypoint[], resumeIndex: number, defaultSpeed: number): number {
  let speed = defaultSpeed;
  let actionOwnsSpeed = false;
  for (let i = 0; i < resumeIndex; i++) {
    const wp = waypoints[i];
    if (wp.speed !== undefined && wp.speed > 0) {
      speed = wp.speed;
      actionOwnsSpeed = false;
    } else if (!actionOwnsSpeed) {
      speed = defaultSpeed;
    }
    for (const act of wp.actions ?? []) {
      if (act.command === "DO_SET_SPEED" && (act.param2 ?? 0) > 0) {
        speed = act.param2 as number;
        actionOwnsSpeed = true;
      }
    }
  }
  return speed;
}

/**
 * The last camera trigger still running when the vehicle leaves
 * `waypoints[resumeIndex - 1]`: a distance trigger or a timed photo series.
 * A later stop (trigger distance 0, or PHOTO_STOP) cancels it.
 */
function cameraInEffect(waypoints: readonly Waypoint[], resumeIndex: number): CommandMissionAction | undefined {
  let active: CommandMissionAction | undefined;
  for (let i = 0; i < resumeIndex; i++) {
    for (const act of waypoints[i].actions ?? []) {
      if (act.command === "DO_SET_CAM_TRIGG") active = (act.param1 ?? 0) > 0 ? act : undefined;
      else if (act.command === "PHOTO_INTERVAL") active = act;
      else if (act.command === "PHOTO_STOP") active = undefined;
    }
  }
  return active;
}

/**
 * Build the mission that resumes `waypoints` at `resumeIndex`:
 * 1. the plan's TAKEOFF (without its actions), or a TAKEOFF synthesized at
 *    `takeoffAltM` above home over the resume waypoint;
 * 2. a copy of `waypoints[resumeIndex - 1]` whose actions are only a
 *    DO_SET_SPEED for the speed in effect there and the camera trigger in
 *    effect there, if any;
 * 3. `waypoints.slice(resumeIndex)` unchanged.
 *
 * @throws RangeError when `resumeIndex` is not inside the plan (≤ 0 or ≥ length).
 */
export function buildResumeMission(
  waypoints: Waypoint[],
  resumeIndex: number,
  defaults: ResumeDefaults,
): Waypoint[] {
  if (!Number.isInteger(resumeIndex) || resumeIndex <= 0 || resumeIndex >= waypoints.length) {
    throw new RangeError(`Resume index ${resumeIndex} is outside the plan (1..${waypoints.length - 1})`);
  }
  const anchor = waypoints[resumeIndex - 1];
  const planTakeoff = waypoints.find((w) => TAKEOFF_COMMANDS[w.command ?? "WAYPOINT"]);
  const takeoff: Waypoint = planTakeoff
    ? { ...planTakeoff, id: `${planTakeoff.id}-resume-takeoff`, actions: undefined }
    : {
        id: `${anchor.id}-resume-takeoff`,
        command: "TAKEOFF",
        frame: "relative",
        lat: anchor.lat,
        lon: anchor.lon,
        alt: defaults.takeoffAltM,
      };

  const fixedWing = defaults.vehicleClass === "plane" || defaults.vehicleClass === "vtol";
  const actions: CommandMissionAction[] = [
    {
      id: `${anchor.id}-resume-speed`,
      command: "DO_SET_SPEED",
      param1: fixedWing ? SPEED_TYPE_AIRSPEED : SPEED_TYPE_GROUND,
      param2: speedInEffect(waypoints, resumeIndex, defaults.speedMps),
      param3: THROTTLE_NO_CHANGE,
    },
  ];
  const camera = cameraInEffect(waypoints, resumeIndex);
  if (camera) actions.push({ ...camera, id: `${anchor.id}-resume-camera` });

  // A takeoff anchor (resuming right after the climb) is re-flown as a plain
  // waypoint at its altitude; the mission already starts with a TAKEOFF.
  const anchorCommand = TAKEOFF_COMMANDS[anchor.command ?? "WAYPOINT"] ? "WAYPOINT" : anchor.command;
  const resumePoint: Waypoint = {
    ...anchor,
    id: `${anchor.id}-resume`,
    command: anchorCommand,
    actions,
  };

  return [takeoff, resumePoint, ...waypoints.slice(resumeIndex)];
}
