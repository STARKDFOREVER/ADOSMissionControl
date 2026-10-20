/**
 * @module mission/command-map
 * @description The mission command name <-> MAVLink MAV_CMD number table. A
 * leaf module: the file-format readers and the mission expander both import it.
 * @license GPL-3.0-only
 */

import type { WaypointCommand } from "@/lib/types";

/**
 * MAVLink command string -> number mapping. ROI is written as
 * DO_SET_ROI_LOCATION (195): the legacy DO_SET_ROI (201) carries the ROI mode
 * in param1, where 0 means "no ROI" to PX4.
 */
export const cmdMap: Record<WaypointCommand, number> = {
  WAYPOINT: 16, SPLINE_WAYPOINT: 82, LOITER: 17, LOITER_TURNS: 18, LOITER_TIME: 19,
  RTL: 20, LAND: 21, TAKEOFF: 22, ROI: 195, DO_SET_SPEED: 178,
  DO_SET_CAM_TRIGG: 206, DO_DIGICAM: 203, DO_JUMP: 177, DELAY: 112,
  CONDITION_YAW: 115, DO_SET_SERVO: 183, DO_FENCE_ENABLE: 207,
  DO_MOUNT_CONTROL: 205, DO_GRIPPER: 211, DO_WINCH: 42600,
  NAV_PAYLOAD_PLACE: 94, CONDITION_DISTANCE: 114, DO_SET_HOME: 179,
  DO_AUX_FUNCTION: 218, VTOL_TAKEOFF: 84, VTOL_LAND: 85,
  DO_SET_ROI_NONE: 197,
  DO_LAND_START: 189,
  PHOTO_INTERVAL: 2000, PHOTO_STOP: 2001, VIDEO_START: 2500, VIDEO_STOP: 2501,
};

/** MAVLink command number -> string mapping. */
export const reverseCmd: Record<number, WaypointCommand> = Object.fromEntries(
  Object.entries(cmdMap).map(([k, v]) => [v, k as WaypointCommand])
) as Record<number, WaypointCommand>;

/** MAV_CMD_DO_SET_ROI: the legacy ROI command; param1 is the ROI mode. */
export const MAV_CMD_DO_SET_ROI = 201;
/** MAV_ROI_LOCATION: DO_SET_ROI mode that points at the item's location. */
export const MAV_ROI_LOCATION = 3;
/** MAV_CMD_NAV_DELAY: the delay PX4 executes (it rejects CONDITION_DELAY). */
export const MAV_CMD_NAV_DELAY = 93;
