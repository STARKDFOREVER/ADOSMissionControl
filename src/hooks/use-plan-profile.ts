/**
 * @module use-plan-profile
 * @description The autopilot and vehicle class the open plan is written for.
 *
 * The plan's own profile wins. A plan with none follows the vehicle it is
 * assigned to (or the selected vehicle), and with nothing connected the
 * planner assumes an ArduPilot multirotor.
 *
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useMissionStore } from "@/stores/mission-store";
import { DEFAULT_PLAN_PROFILE, profileFromVehicleInfo } from "@/lib/mission/plan-profile";
import type { PlanVehicleProfile } from "@/lib/types";

/**
 * The profile a connected vehicle reports: `droneId` when it is connected,
 * else the selected vehicle. `null` with nothing connected, or for a firmware
 * that is not a MAVLink mission autopilot.
 */
export function useReportedVehicleProfile(droneId?: string | null): PlanVehicleProfile | null {
  const assigned = useDroneManager((s) => (droneId ? s.drones.get(droneId)?.protocol ?? null : null));
  const selected = useDroneManager(selectSelectedProtocol);
  const protocol = assigned ?? selected;
  const info = protocol?.getVehicleInfo();
  const firmwareType = info?.firmwareType;
  const vehicleClass = info?.vehicleClass;
  // Stable identity while the vehicle reports the same thing, so callers can
  // use the profile as a memo dependency.
  return useMemo(
    () => (firmwareType && vehicleClass ? profileFromVehicleInfo({ firmwareType, vehicleClass }) : null),
    [firmwareType, vehicleClass],
  );
}

/** The profile the open plan is planned for. Never null. */
export function usePlanVehicleProfile(droneId?: string | null): PlanVehicleProfile {
  const own = useMissionStore((s) => s.vehicleProfile);
  const reported = useReportedVehicleProfile(droneId);
  return own ?? reported ?? DEFAULT_PLAN_PROFILE;
}
