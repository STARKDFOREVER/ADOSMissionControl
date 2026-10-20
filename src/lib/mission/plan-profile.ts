/**
 * @module mission/plan-profile
 * @description The autopilot and vehicle class a plan is encoded and flown for,
 * derived from what a connected vehicle reports.
 *
 * Kept free of store imports so the mission store, the upload path and the
 * planner hooks can all use it without an import cycle.
 *
 * @license GPL-3.0-only
 */

import type { PlanVehicleProfile } from "@/lib/types";
import type { VehicleInfo } from "@/lib/protocol/types";

/** The profile a plan uses when neither the plan nor a vehicle names one. */
export const DEFAULT_PLAN_PROFILE: PlanVehicleProfile = Object.freeze({
  autopilot: "ardupilot",
  vehicleClass: "copter",
});

/**
 * The plan profile a vehicle reports, or `null` when its firmware is not a
 * MAVLink mission autopilot (iNav, Betaflight, unknown).
 */
export function profileFromVehicleInfo(
  info: Pick<VehicleInfo, "firmwareType" | "vehicleClass"> | null | undefined,
): PlanVehicleProfile | null {
  if (!info) return null;
  const { firmwareType, vehicleClass } = info;
  let autopilot: PlanVehicleProfile["autopilot"];
  if (firmwareType.startsWith("ardupilot-")) autopilot = "ardupilot";
  else if (firmwareType === "px4") autopilot = "px4";
  else return null;

  let cls: PlanVehicleProfile["vehicleClass"];
  if (vehicleClass === "vtol") cls = "vtol";
  else if (firmwareType === "ardupilot-plane" || vehicleClass === "plane") cls = "plane";
  else if (firmwareType === "ardupilot-rover" || vehicleClass === "rover") cls = "rover";
  else cls = "copter";
  return { autopilot, vehicleClass: cls };
}

/** True when two profiles name the same autopilot and vehicle class. */
export function sameProfile(a: PlanVehicleProfile, b: PlanVehicleProfile): boolean {
  return a.autopilot === b.autopilot && a.vehicleClass === b.vehicleClass;
}
