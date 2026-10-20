/**
 * The mission items a PX4 vehicle accepts, for the demo PX4 vehicle's upload.
 *
 * Mirrors PX4's mission parser (`parse_mavlink_mission_item`) and its mission
 * feasibility checker: which commands it reads in a position frame and which
 * only in `MAV_FRAME_MISSION`, its frame whitelist, its DO_JUMP and ROI
 * parameter checks, and its refusal of VTOL items on a vehicle that is not a
 * VTOL. A real PX4 vehicle answers the first bad item with a MISSION_ACK error
 * and ends the transfer; the demo does the same, so a plan the real vehicle
 * would refuse is refused in demo mode and in tests too.
 *
 * @license GPL-3.0-only
 */

import type { MissionItem, VehicleClass } from "@/lib/protocol/types";

/** MAV_MISSION_RESULT values PX4 answers a bad item with. */
export const MAV_MISSION_RESULT = {
  ERROR: 1,
  UNSUPPORTED_FRAME: 2,
  UNSUPPORTED: 3,
  INVALID_PARAM1: 6,
  INVALID_PARAM2: 7,
} as const;

/** MAV_FRAME_GLOBAL, GLOBAL_RELATIVE_ALT and their _INT spellings. */
const POSITION_FRAMES: ReadonlySet<number> = new Set([0, 3, 5, 6]);
const MAV_FRAME_MISSION = 2;

/** Commands PX4 parses in a position frame. */
const POSITION_COMMANDS: ReadonlySet<number> = new Set([
  16, 17, 19, 21, 22, 31, 80, 84, 85, 195, 201, 212, 400, 4501,
  5000, 5001, 5002, 5003, 5004, 5100,
]);

/** Commands PX4 parses in `MAV_FRAME_MISSION`. */
const MISSION_FRAME_COMMANDS: ReadonlySet<number> = new Set([
  20, 80, 93, 112, 177, 178, 179, 187, 189, 197, 200, 201, 203, 204, 205, 206,
  211, 212, 213, 214, 260, 400, 530, 531, 534, 1000, 1001, 2000, 2001, 2003,
  2500, 2501, 3000, 42600,
]);

/** VTOL-only commands, refused on any other vehicle. */
const VTOL_COMMANDS: ReadonlySet<number> = new Set([84, 85, 3000]);

const MAV_CMD_DO_JUMP = 177;
const MAV_CMD_DO_SET_ROI = 201;
const MAV_CMD_CONDITION_DELAY = 112;
const MAV_ROI_NONE = 0;
const MAV_ROI_LOCATION = 3;

/** The first item PX4 would refuse, with its MAV_MISSION_RESULT; `null` when it accepts them all. */
export function px4MissionRejection(
  items: readonly MissionItem[],
  vehicleClass: VehicleClass,
): { seq: number; result: number } | null {
  for (const item of items) {
    const refuse = (result: number) => ({ seq: item.seq, result });
    if (POSITION_FRAMES.has(item.frame)) {
      if (!POSITION_COMMANDS.has(item.command)) return refuse(MAV_MISSION_RESULT.UNSUPPORTED);
      if (item.command === MAV_CMD_DO_SET_ROI && item.param1 !== MAV_ROI_LOCATION && item.param1 !== MAV_ROI_NONE) {
        return refuse(MAV_MISSION_RESULT.INVALID_PARAM1);
      }
    } else if (item.frame === MAV_FRAME_MISSION) {
      if (!MISSION_FRAME_COMMANDS.has(item.command)) return refuse(MAV_MISSION_RESULT.UNSUPPORTED);
      if (item.command === MAV_CMD_DO_JUMP) {
        // Only a jump back to an earlier item, with a repeat count a uint16 holds.
        if (!(item.param1 >= 0 && item.param1 < item.seq)) return refuse(MAV_MISSION_RESULT.INVALID_PARAM1);
        if (!(item.param2 >= 0 && item.param2 <= 0xffff)) return refuse(MAV_MISSION_RESULT.INVALID_PARAM2);
      }
    } else {
      return refuse(MAV_MISSION_RESULT.UNSUPPORTED_FRAME);
    }
    // The feasibility check that runs once the items are stored.
    if (VTOL_COMMANDS.has(item.command) && vehicleClass !== "vtol") return refuse(MAV_MISSION_RESULT.ERROR);
    if (item.command === MAV_CMD_CONDITION_DELAY) return refuse(MAV_MISSION_RESULT.ERROR);
  }
  return null;
}
