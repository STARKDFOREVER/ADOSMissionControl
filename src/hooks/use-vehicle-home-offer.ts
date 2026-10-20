/**
 * @module use-vehicle-home-offer
 * @description The selected vehicle's reported home, offered as the plan's
 * planned home when it differs from it.
 *
 * A vehicle reports the home of the site it sits at. It is offered only when
 * that site is the plan's (within the plan-site bound of the launch point)
 * and the home is far enough from the planned home to matter.
 *
 * @license GPL-3.0-only
 */
"use client";

import { useMissionStore } from "@/stores/mission-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { haversineDistance } from "@/lib/geo/distance";
import { isHomeNearPlan } from "@/lib/mission/plan-home";
import type { PlannedHome, Waypoint } from "@/lib/types";

/** A vehicle home closer than this to the planned home is the same place. */
export const VEHICLE_HOME_OFFER_M = 30;

/** A home the vehicle reports: position plus its altitude, metres AMSL. */
export interface VehicleHome {
  lat: number;
  lon: number;
  alt: number;
}

/**
 * The vehicle home to offer as the planned home, or `null` when there is
 * nothing to offer: no reported home, a home at another site, or one within
 * {@link VEHICLE_HOME_OFFER_M} of the planned home. With no planned home a
 * home at the plan's site is always offered.
 */
export function vehicleHomeOffer(
  plannedHome: PlannedHome | null,
  vehicleHome: VehicleHome | null | undefined,
  waypoints: readonly Waypoint[],
): VehicleHome | null {
  if (!vehicleHome) return null;
  if (!Number.isFinite(vehicleHome.lat) || !Number.isFinite(vehicleHome.lon)) return null;
  // 0/0 is what a vehicle reports before it has a home.
  if (vehicleHome.lat === 0 && vehicleHome.lon === 0) return null;
  if (!isHomeNearPlan(vehicleHome, waypoints)) return null;
  if (
    plannedHome &&
    haversineDistance(plannedHome.lat, plannedHome.lon, vehicleHome.lat, vehicleHome.lon) <= VEHICLE_HOME_OFFER_M
  ) {
    return null;
  }
  return { lat: vehicleHome.lat, lon: vehicleHome.lon, alt: vehicleHome.alt };
}

/** {@link vehicleHomeOffer} for the open plan and the selected vehicle's telemetry. */
export function useVehicleHomeOffer(): VehicleHome | null {
  const plannedHome = useMissionStore((s) => s.plannedHome);
  const waypoints = useMissionStore((s) => s.waypoints);
  // Home is latched: the newest report is the one in force. The ring buffer
  // returns the same object until a new report lands, so this is stable.
  const vehicleHome = useTelemetryStore((s) => s.homePosition.latest());
  return vehicleHomeOffer(plannedHome, vehicleHome, waypoints);
}
