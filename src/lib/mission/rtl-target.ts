/**
 * Where an RTL flies and how high: the rally point or home the autopilot picks,
 * and the return altitude after an altitude fence caps it. Shared by the flight
 * estimate (simulation, statistics) and the RTL terrain advisory so both assume
 * the same return leg.
 *
 * - ArduPilot (`AP_Rally`): the nearest rally point, unless it lies farther than
 *   `RALLY_LIMIT_KM` (0.3 km Copter, 5 km Plane by default); home competes
 *   with it only when `RALLY_INCL_HOME` is set (Copter default 1, Plane 0).
 * - PX4: `RTL_TYPE` 0 (multicopter default) and 1 (fixed-wing default) fly to
 *   the closest of the rally points and home; other types follow the mission
 *   path back and are approximated by home.
 * - ArduPilot caps the return altitude at `FENCE_ALT_MAX − FENCE_MARGIN` when an
 *   altitude fence is enabled.
 *
 * @module mission/rtl-target
 * @license GPL-3.0-only
 */

import type { PlanAutopilot, PlanVehicleClass } from "@/lib/types/mission";
import { haversineDistance } from "@/lib/geo/distance";

export interface LatLon {
  lat: number;
  lon: number;
}

/** The autopilot rules that pick an RTL target. Absent values take the firmware defaults. */
export interface RtlTargetRules {
  autopilot: PlanAutopilot;
  vehicleClass: PlanVehicleClass;
  /** ArduPilot `RALLY_LIMIT_KM`; 0 means no limit. */
  rallyLimitKm?: number;
  /** ArduPilot `RALLY_INCL_HOME`. */
  rallyIncludeHome?: boolean;
  /** PX4 `RTL_TYPE`. */
  px4RtlType?: number;
}

export type RtlTarget =
  | { kind: "home"; lat: number; lon: number }
  | { kind: "rally"; lat: number; lon: number; /** Index into the rally list. */ rallyIndex: number };

/** ArduPilot's default `RALLY_LIMIT_KM` for a vehicle class. */
export function defaultRallyLimitKm(vehicleClass: PlanVehicleClass): number {
  return vehicleClass === "plane" || vehicleClass === "vtol" ? 5 : 0.3;
}

/** ArduPilot's default `RALLY_INCL_HOME` for a vehicle class. */
export function defaultRallyIncludeHome(vehicleClass: PlanVehicleClass): boolean {
  return !(vehicleClass === "plane" || vehicleClass === "vtol");
}

/** The point an RTL started at `from` flies to. */
export function rtlTarget(
  from: LatLon,
  home: LatLon,
  rally: readonly LatLon[],
  rules: RtlTargetRules,
): RtlTarget {
  const homeTarget: RtlTarget = { kind: "home", lat: home.lat, lon: home.lon };
  if (rally.length === 0) return homeTarget;

  let nearest = -1;
  let nearestM = Infinity;
  rally.forEach((p, i) => {
    const d = haversineDistance(from.lat, from.lon, p.lat, p.lon);
    if (d < nearestM) {
      nearestM = d;
      nearest = i;
    }
  });
  const rallyTarget: RtlTarget = { kind: "rally", lat: rally[nearest].lat, lon: rally[nearest].lon, rallyIndex: nearest };
  const homeM = haversineDistance(from.lat, from.lon, home.lat, home.lon);

  if (rules.autopilot === "px4") {
    const type = rules.px4RtlType ?? (rules.vehicleClass === "copter" ? 0 : 1);
    if (type !== 0 && type !== 1) return homeTarget;
    return nearestM < homeM ? rallyTarget : homeTarget;
  }

  const limitKm = rules.rallyLimitKm ?? defaultRallyLimitKm(rules.vehicleClass);
  if (limitKm > 0 && nearestM > limitKm * 1000) return homeTarget;
  const includeHome = rules.rallyIncludeHome ?? defaultRallyIncludeHome(rules.vehicleClass);
  if (includeHome && homeM <= nearestM) return homeTarget;
  return rallyTarget;
}

/**
 * The altitude above home an RTL cruises at from a point `currentAboveHomeM`
 * high: the configured return altitude, capped by the fence's safe ceiling,
 * never below where the vehicle already is.
 */
export function rtlCruiseAltitude(currentAboveHomeM: number, rtlAltM: number, ceilingM?: number): number {
  const capped = ceilingM !== undefined && Number.isFinite(ceilingM) ? Math.min(rtlAltM, ceilingM) : rtlAltM;
  return Math.max(currentAboveHomeM, capped);
}

/**
 * ArduPilot's safe fence ceiling (`FENCE_ALT_MAX − FENCE_MARGIN`), metres above
 * home, when an altitude fence is enabled; undefined otherwise or on PX4,
 * which does not cap its return altitude at the fence.
 */
export function fenceReturnCeiling(
  autopilot: PlanAutopilot,
  fence: { enabled: boolean; maxAltitude: number },
  fenceMarginM = 2,
): number | undefined {
  if (autopilot !== "ardupilot" || !fence.enabled || !(fence.maxAltitude > 0)) return undefined;
  return Math.max(0, fence.maxAltitude - fenceMarginM);
}
