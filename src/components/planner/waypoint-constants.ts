/**
 * @module waypoint-constants
 * @description Constants for the waypoint outline rows and inspector: command options, command letter map.
 * @license GPL-3.0-only
 */

import type { ActionCommand, CommandMissionAction, NavCommand, Waypoint, WaypointCommand } from "@/lib/types";
import type { VehicleClass } from "@/lib/protocol/types";

/**
 * The commands a navigation waypoint's own command Select offers. Only navigation
 * commands appear here — action commands (DO_/CONDITION_) attach to a waypoint via
 * the action timeline, never as the waypoint's own command.
 */
export const NAV_COMMAND_OPTIONS: { value: NavCommand; label: string }[] = [
  { value: "WAYPOINT", label: "Waypoint" },
  { value: "SPLINE_WAYPOINT", label: "Spline waypoint" },
  { value: "TAKEOFF", label: "Takeoff" },
  { value: "LAND", label: "Land" },
  { value: "LOITER", label: "Loiter (unlimited)" },
  { value: "LOITER_TIME", label: "Loiter (time)" },
  { value: "LOITER_TURNS", label: "Loiter (turns)" },
  { value: "RTL", label: "Return to launch" },
  { value: "VTOL_TAKEOFF", label: "VTOL takeoff" },
  { value: "VTOL_LAND", label: "VTOL land" },
  { value: "NAV_PAYLOAD_PLACE", label: "Payload place" },
  { value: "DO_LAND_START", label: "Land start" },
];

/**
 * Action commands grouped for the "Add action" picker. Labels are resolved via
 * i18n (`planner.actions.cmd.*` / `planner.actions.group.*`) in the component, so
 * only the structure lives here.
 */
export const ACTION_COMMAND_GROUPS: { groupKey: string; commands: ActionCommand[] }[] = [
  { groupKey: "camera", commands: ["DO_DIGICAM", "PHOTO_INTERVAL", "PHOTO_STOP", "VIDEO_START", "VIDEO_STOP", "DO_SET_CAM_TRIGG"] },
  { groupKey: "gimbal", commands: ["DO_MOUNT_CONTROL", "ROI", "DO_SET_ROI_NONE"] },
  { groupKey: "movement", commands: ["DO_SET_SPEED", "CONDITION_YAW"] },
  { groupKey: "payload", commands: ["DO_SET_SERVO", "DO_GRIPPER", "DO_WINCH", "DO_AUX_FUNCTION"] },
  { groupKey: "flow", commands: ["DO_JUMP", "DELAY", "CONDITION_DISTANCE"] },
  { groupKey: "system", commands: ["DO_FENCE_ENABLE", "DO_SET_HOME"] },
];

/**
 * The attached actions iNav can fly: ROI → SET_POI, DO_JUMP → JUMP and
 * CONDITION_YAW → SET_HEAD. Any other action has no iNav equivalent and the
 * upload refuses it.
 */
export const INAV_ACTION_COMMANDS: readonly ActionCommand[] = ["ROI", "DO_JUMP", "CONDITION_YAW"];

/**
 * The iNav waypoint actions that own a position, each mapped onto the
 * navigation command the mission model and the iNav translator share. SET_POI,
 * JUMP and SET_HEAD are attached actions (ROI, DO_JUMP, CONDITION_YAW).
 */
export const INAV_ACTION_OPTIONS: { value: NavCommand; label: string }[] = [
  { value: "WAYPOINT",    label: "WAYPOINT" },
  { value: "LOITER",      label: "POSHOLD_UNLIM" },
  { value: "LOITER_TIME", label: "POSHOLD_TIME" },
  { value: "RTL",         label: "RTH" },
  { value: "LAND",        label: "LAND" },
];

/** iNav action name per navigation command, for compact rows. */
export const INAV_ACTION_LABEL: Record<string, string> = Object.fromEntries(
  INAV_ACTION_OPTIONS.map((o) => [o.value, o.label]),
);

/**
 * The planner's default acceptance radius for a newly created waypoint. It
 * applies to pass-through waypoints only (model param1, sent as NAV_WAYPOINT /
 * NAV_SPLINE_WAYPOINT param2); 0 leaves the choice to the FC (WP_RADIUS).
 */
export function acceptRadiusDefault(command: WaypointCommand, radius: number): { param1?: number } {
  return (command === "WAYPOINT" || command === "SPLINE_WAYPOINT") && radius > 0 ? { param1: radius } : {};
}

/**
 * The update that switches a waypoint to `command`. Every parameter slot
 * starts clean and then takes the new command's defaults: each slot means
 * something different per command, and a kept value turns into a different
 * instruction (an acceptance radius becomes LAND's precision-landing mode or
 * VTOL_TAKEOFF's transition heading on PX4).
 */
export function commandChangeUpdate(
  command: NavCommand,
  acceptRadius: number,
): Pick<Waypoint, "command" | "holdTime" | "param1" | "param2" | "param3"> {
  return {
    command,
    holdTime: undefined,
    param1: undefined,
    param2: undefined,
    param3: undefined,
    ...acceptRadiusDefault(command, acceptRadius),
  };
}

/** MAV_CMD_DO_CHANGE_SPEED param1 (speed type). */
export const SPEED_TYPE_AIRSPEED = 0;
export const SPEED_TYPE_GROUND = 1;

/**
 * Sensible default parameters applied when a fresh action of the given command is
 * added, so a newly-inserted action is immediately valid rather than all-zero.
 * A positioned action (ROI, DO_SET_HOME) starts at the ground point below the
 * waypoint it rides; a location of 0,0 would upload as "clear ROI" / the
 * null island. A speed change targets airspeed on a fixed-wing vehicle (where
 * a ground-speed change sets the minimum ground speed instead) and ground speed
 * otherwise.
 */
export function defaultActionParams(
  command: ActionCommand,
  parent: { lat: number; lon: number },
  vehicleClass?: VehicleClass | null,
): Partial<CommandMissionAction> {
  switch (command) {
    case "DO_SET_SPEED": {
      const fixedWing = vehicleClass === "plane" || vehicleClass === "vtol";
      return { param1: fixedWing ? SPEED_TYPE_AIRSPEED : SPEED_TYPE_GROUND, param2: 5 }; // 5 m/s
    }
    case "DO_SET_CAM_TRIGG": return { param1: 10 }; // trigger every 10 m
    case "DELAY": return { param1: 3 }; // 3 s
    case "CONDITION_DISTANCE": return { param1: 50 }; // 50 m
    case "CONDITION_YAW": return { param1: 0, param2: 0, param3: 0 }; // heading 0, abs, shortest turn
    case "DO_SET_SERVO": return { param1: 5, param2: 1500 }; // servo 5, 1500 us
    case "DO_MOUNT_CONTROL": return { param1: -30 }; // pitch down 30°
    case "DO_GRIPPER": return { param1: 1, param2: 1 }; // gripper 1, grab
    case "DO_WINCH": return { param1: 1, param2: 1 }; // winch 1, length control
    case "DO_DIGICAM": return { param5: 1 }; // shoot command = take one photo
    case "DO_FENCE_ENABLE": return { param1: 1 }; // enable
    case "DO_AUX_FUNCTION": return { param1: 0, param2: 0 };
    case "ROI":
    case "DO_SET_HOME": return { lat: parent.lat, lon: parent.lon, alt: 0 };
    case "PHOTO_INTERVAL": return { param2: 2 }; // a photo every 2 s, no count limit
    default: return {}; // DO_SET_ROI_NONE, PHOTO_STOP, VIDEO_START, VIDEO_STOP
  }
}

export const CMD_LETTER: Record<string, string> = {
  TAKEOFF: "T",
  WAYPOINT: "W",
  SPLINE_WAYPOINT: "S",
  LOITER: "L",
  LOITER_TIME: "L",
  LOITER_TURNS: "L",
  RTL: "R",
  LAND: "D",
  ROI: "O",
  NAV_PAYLOAD_PLACE: "P",
  DO_SET_SPEED: "S",
  DELAY: "Y",
  CONDITION_YAW: "Y",
  CONDITION_DISTANCE: "D",
  DO_SET_CAM_TRIGG: "C",
  DO_DIGICAM: "C",
  PHOTO_INTERVAL: "C",
  PHOTO_STOP: "C",
  VIDEO_START: "V",
  VIDEO_STOP: "V",
  DO_JUMP: "J",
  DO_SET_SERVO: "V",
  DO_MOUNT_CONTROL: "G",
  DO_GRIPPER: "G",
  DO_WINCH: "N",
  DO_FENCE_ENABLE: "F",
  DO_SET_HOME: "H",
  DO_AUX_FUNCTION: "A",
  VTOL_TAKEOFF: "T",
  VTOL_LAND: "D",
  DO_LAND_START: "D",
};
