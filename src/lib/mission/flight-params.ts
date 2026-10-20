/**
 * The vehicle parameters the flight estimate reads from a connected vehicle:
 * climb and descent rates, landing speed, the RTL loiter, the rally rules and
 * the fence margin. Each is read under its current name first and its older
 * name after it, scaled to SI units; a parameter the vehicle does not have
 * stays absent and the estimate uses the firmware default.
 *
 * @module mission/flight-params
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types";
import type { PlanVehicleClass } from "@/lib/types/mission";

export interface VehicleFlightParams {
  /** Vertical climb rate, m/s. */
  climbRateMps?: number;
  /** Vertical descent rate, m/s. */
  descentRateMps?: number;
  /** Final landing descent rate, m/s. */
  landSpeedMps?: number;
  /** Height above ground where the final landing descent starts, metres. */
  landSlowAltM?: number;
  /** Seconds an RTL loiters over the return point before descending. */
  rtlLoiterS?: number;
  /** ArduPilot `RALLY_LIMIT_KM`. */
  rallyLimitKm?: number;
  /** ArduPilot `RALLY_INCL_HOME`. */
  rallyIncludeHome?: boolean;
  /** PX4 `RTL_TYPE`. */
  px4RtlType?: number;
  /** ArduPilot `FENCE_MARGIN`, metres. */
  fenceMarginM?: number;
}

/** Parameter names per field, newest first, each with its scale to SI. */
type Sources = Partial<Record<keyof VehicleFlightParams, ReadonlyArray<[string, number]>>>;

const ARDUCOPTER: Sources = {
  climbRateMps: [["WP_SPD_UP", 1], ["WPNAV_SPEED_UP", 0.01]],
  descentRateMps: [["WP_SPD_DN", 1], ["WPNAV_SPEED_DN", 0.01]],
  landSpeedMps: [["LAND_SPD_MS", 1], ["LAND_SPEED", 0.01]],
  landSlowAltM: [["LAND_ALT_LOW_M", 1], ["LAND_ALT_LOW", 0.01]],
  rtlLoiterS: [["RTL_LOIT_TIME", 0.001]],
  rallyLimitKm: [["RALLY_LIMIT_KM", 1]],
  rallyIncludeHome: [["RALLY_INCL_HOME", 1]],
  fenceMarginM: [["FENCE_MARGIN", 1]],
};

const ARDUPLANE: Sources = {
  climbRateMps: [["TECS_CLMB_MAX", 1]],
  descentRateMps: [["TECS_SINK_MAX", 1]],
  rallyLimitKm: [["RALLY_LIMIT_KM", 1]],
  rallyIncludeHome: [["RALLY_INCL_HOME", 1]],
  fenceMarginM: [["FENCE_MARGIN", 1]],
};

const PX4_MULTICOPTER: Sources = {
  climbRateMps: [["MPC_Z_VEL_MAX_UP", 1]],
  descentRateMps: [["MPC_Z_VEL_MAX_DN", 1]],
  landSpeedMps: [["MPC_LAND_SPEED", 1]],
  rtlLoiterS: [["RTL_LAND_DELAY", 1]],
  px4RtlType: [["RTL_TYPE", 1]],
};

const PX4_FIXED_WING: Sources = {
  climbRateMps: [["FW_T_CLMB_MAX", 1]],
  descentRateMps: [["FW_T_SINK_MAX", 1]],
  px4RtlType: [["RTL_TYPE", 1]],
};

/** The first readable, finite value among `sources`, scaled; undefined when none is. */
async function readFirst(protocol: DroneProtocol, sources: ReadonlyArray<[string, number]>): Promise<number | undefined> {
  for (const [name, scale] of sources) {
    try {
      const value = (await protocol.getParameter(name)).value * scale;
      if (Number.isFinite(value)) return value;
    } catch {
      // not on this firmware version: try the older name
    }
  }
  return undefined;
}

/**
 * Read the flight-model parameters from `protocol`. `vehicleClass` picks the
 * parameter set (a VTOL climbs and lands as a multirotor).
 */
export async function readVehicleFlightParams(
  protocol: DroneProtocol,
  vehicleClass: PlanVehicleClass,
): Promise<VehicleFlightParams> {
  const firmware = protocol.getVehicleInfo()?.firmwareType;
  const fixedWing = vehicleClass === "plane";
  let sources: Sources;
  if (firmware === "px4") sources = fixedWing ? PX4_FIXED_WING : PX4_MULTICOPTER;
  else if (firmware?.startsWith("ardupilot")) sources = fixedWing ? ARDUPLANE : ARDUCOPTER;
  else return {};

  const out: VehicleFlightParams = {};
  for (const key of Object.keys(sources) as Array<keyof VehicleFlightParams>) {
    const value = await readFirst(protocol, sources[key] ?? []);
    if (value === undefined) continue;
    if (key === "rallyIncludeHome") out.rallyIncludeHome = value !== 0;
    else if (key === "rallyLimitKm" || key === "px4RtlType" || key === "fenceMarginM") out[key] = value;
    // PX4 RTL_LAND_DELAY -1 hovers until the pilot lands: not a timed loiter.
    else if (key === "rtlLoiterS") { if (value >= 0) out.rtlLoiterS = value; }
    else if (value > 0) out[key] = value;
  }
  return out;
}
