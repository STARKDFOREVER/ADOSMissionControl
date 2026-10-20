/**
 * Per-item wire encoding for the mission expander: one planner navigation
 * waypoint, attached action or ArduPilot home slot to one `MissionItem`.
 * Sequence numbers, ordering and DO_JUMP resolution live in `mission-expand`.
 *
 * Frames follow what both autopilots accept. A command whose position the
 * vehicle flies to (or points at) carries the waypoint's altitude frame; every
 * other item is written in `MAV_FRAME_MISSION`, which is the only frame PX4
 * parses DO/CONDITION commands, RTL and DO_LAND_START in, and which ArduPilot
 * accepts for any command.
 *
 * @module mission/mission-item-encode
 * @license GPL-3.0-only
 */

import type { MissionItem } from "@/lib/protocol/types/mission";
import type {
  AltitudeFrame,
  MissionAction,
  PlanAutopilot,
  Waypoint,
  WaypointCommand,
} from "@/lib/types/mission";
import { cmdMap, MAV_CMD_NAV_DELAY } from "./command-map";
import { frameToMav, MAV_FRAME_GLOBAL } from "@/lib/mission/altitude-frame";
import { POSITION_BEARING_ACTIONS } from "./command-classes";

/** `MAV_FRAME_MISSION`: the item carries no position; x/y/z are plain params. */
export const MAV_FRAME_MISSION = 2;

/**
 * Navigation commands whose param4 is a yaw angle where NaN means "keep the
 * autopilot's yaw behaviour" (PX4 MPC_YAW_MODE; ArduPilot ignores the slot and
 * accepts NaN there). LOITER_TIME is absent: its param4 is the exit cross-track
 * flag, and ArduPilot rejects a NaN in it.
 */
const NAN_HEADING_COMMANDS: ReadonlySet<WaypointCommand> = new Set<WaypointCommand>([
  "WAYPOINT", "LOITER", "TAKEOFF", "LAND", "VTOL_TAKEOFF", "VTOL_LAND",
]);

/** The ArduPilot home item written into mission slot 0. */
export function homeItem(home: { lat: number; lon: number; alt: number }): MissionItem {
  return {
    seq: 0,
    frame: MAV_FRAME_GLOBAL,
    command: cmdMap.WAYPOINT,
    current: 0,
    autocontinue: 1,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: Math.round(home.lat * 1e7),
    y: Math.round(home.lon * 1e7),
    z: home.alt,
  };
}

/**
 * Encode one navigation waypoint (one-slot-shift byte mapping). RTL and
 * DO_LAND_START go out in `MAV_FRAME_MISSION`: RTL has no position, and
 * DO_LAND_START is a marker the vehicle never flies to (ArduPilot still reads
 * its x/y to choose the nearest landing sequence, so they are kept). A heading
 * left unset is NaN on the commands where that means "default yaw".
 */
export function navItem(
  wp: Waypoint,
  seq: number,
  current: boolean,
  defaultFrame: AltitudeFrame,
): MissionItem {
  const command = wp.command ?? "WAYPOINT";
  const noFlownPosition = command === "RTL" || command === "DO_LAND_START";
  const heading = wp.param3 ?? (NAN_HEADING_COMMANDS.has(command) ? NaN : 0);
  return {
    seq,
    frame: noFlownPosition ? MAV_FRAME_MISSION : frameToMav(wp.frame ?? defaultFrame),
    command: cmdMap[command] ?? cmdMap.WAYPOINT,
    current: current ? 1 : 0,
    autocontinue: wp.autocontinue === false ? 0 : 1,
    param1: wp.holdTime ?? 0,
    param2: wp.param1 ?? 0,
    param3: wp.param2 ?? 0,
    param4: heading,
    x: wp.inheritsPosition ? 0 : Math.round(wp.lat * 1e7),
    y: wp.inheritsPosition ? 0 : Math.round(wp.lon * 1e7),
    z: wp.alt,
  };
}

/** NAV_DELAY param2..4 (hour, minute, second of day): -1 = not used, delay by param1 seconds. */
const NAV_DELAY_TIME_UNUSED = -1;

/**
 * Encode one attached action item (correct MAVLink parameter slots). A raw
 * passthrough re-emits the item it was collapsed from; a positioned action
 * (ROI, DO_SET_HOME) carries the parent waypoint's altitude frame; every other
 * action goes out in `MAV_FRAME_MISSION`. PX4 executes a delay only as
 * NAV_DELAY, so DELAY is written that way for PX4 (ArduPilot keeps
 * CONDITION_DELAY).
 */
export function actionItem(
  act: MissionAction,
  seq: number,
  parentFrame: number,
  seqById: ReadonlyMap<string, number>,
  autopilot: PlanAutopilot,
): MissionItem {
  const autocontinue = act.autocontinue === false ? 0 : 1;
  if (act.command === "RAW") {
    return {
      seq,
      frame: act.frame,
      command: act.rawCommand,
      current: 0,
      autocontinue,
      param1: act.param1,
      param2: act.param2,
      param3: act.param3,
      param4: act.param4,
      x: act.x,
      y: act.y,
      z: act.z,
    };
  }

  const positional = POSITION_BEARING_ACTIONS.has(act.command);
  const base = {
    seq,
    frame: positional ? parentFrame : MAV_FRAME_MISSION,
    current: 0,
    autocontinue,
  };

  if (act.command === "DELAY" && autopilot === "px4") {
    return {
      ...base,
      command: MAV_CMD_NAV_DELAY,
      param1: act.param1 ?? 0,
      param2: NAV_DELAY_TIME_UNUSED,
      param3: NAV_DELAY_TIME_UNUSED,
      param4: NAV_DELAY_TIME_UNUSED,
      x: 0,
      y: 0,
      z: 0,
    };
  }

  // DO_JUMP overrides param1 with the flattened target seq (guaranteed resolved
  // by the expander) and carries the repeat count in param2.
  const param1 = act.command === "DO_JUMP"
    ? (seqById.get(act.jumpTargetId as string) as number)
    : act.param1 ?? 0;

  return {
    ...base,
    command: cmdMap[act.command],
    param1,
    param2: act.param2 ?? 0,
    param3: act.param3 ?? 0,
    param4: act.param4 ?? 0,
    // A positional action carries its location in x/y/z; every other action
    // carries MAVLink param5..7 there unscaled (DO_DIGICAM's shoot command).
    x: positional ? Math.round((act.lat ?? 0) * 1e7) : act.param5 ?? 0,
    y: positional ? Math.round((act.lon ?? 0) * 1e7) : act.param6 ?? 0,
    z: positional ? act.alt ?? 0 : act.param7 ?? 0,
  };
}
