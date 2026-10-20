/**
 * @module use-rtl-return-context
 * @description The datums the flight estimate and the RTL checks share, from
 * the plan first and the connected vehicle second:
 *
 * - home: the plan's planned home with its ground elevation; without one, the
 *   plan's launch point with the ground sampled under that waypoint. A vehicle
 *   home never moves the plan's datum (it only seeds an unset planned home).
 * - the return altitude (ArduCopter `RTL_ALT_M`/`RTL_ALT`, ArduPlane
 *   `RTL_ALTITUDE`/`ALT_HOLD_RTL`, PX4 `RTL_RETURN_ALT`), capped by an
 *   ArduPilot altitude fence at `FENCE_ALT_MAX − FENCE_MARGIN`;
 * - the rally points and the rules that pick the RTL target;
 * - the climb, descent and landing rates the vehicle is configured with.
 *
 * A value the vehicle has not reported stays `undefined`: the RTL terrain
 * check then reports itself unchecked, and the flight estimate uses the
 * firmware default.
 *
 * @license GPL-3.0-only
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { DroneProtocol } from "@/lib/protocol/types";
import type { PlanVehicleClass, Waypoint } from "@/lib/types";
import type { FlightPlanOptions } from "@/lib/flight-plan";
import type { RtlTargetRules } from "@/lib/mission/rtl-target";
import { fenceReturnCeiling } from "@/lib/mission/rtl-target";
import { readVehicleFlightParams, type VehicleFlightParams } from "@/lib/mission/flight-params";
import { planLaunchPoint } from "@/lib/mission/plan-home";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useRallyStore } from "@/stores/rally-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { usePlanVehicleProfile } from "@/hooks/use-plan-profile";
import { readReturnAltitude } from "@/components/map/context-menu/actions/markers";

export interface RtlReturnContext {
  /** Planned home (else the launch point) with the terrain elevation (metres MSL) under it. */
  home?: { lat: number; lon: number; groundElevation: number };
  /** Configured return altitude, metres above home. */
  rtlAltitude?: number;
  /** Return altitude ceiling from an ArduPilot altitude fence, metres above home. */
  returnCeilingM?: number;
  /** Rally points an RTL may return to. */
  rally: ReadonlyArray<{ lat: number; lon: number }>;
  /** The autopilot rules that pick the RTL target. */
  rules: RtlTargetRules;
}

interface VehicleReturnReadings extends VehicleFlightParams {
  rtlAltM?: number;
}

/** One read per link and vehicle class, shared by every component that asks. */
const readings = new WeakMap<DroneProtocol, Map<PlanVehicleClass, Promise<VehicleReturnReadings>>>();

function readOnce(protocol: DroneProtocol, vehicleClass: PlanVehicleClass): Promise<VehicleReturnReadings> {
  let perClass = readings.get(protocol);
  if (!perClass) {
    perClass = new Map();
    readings.set(protocol, perClass);
  }
  let pending = perClass.get(vehicleClass);
  if (!pending) {
    pending = Promise.all([readVehicleFlightParams(protocol, vehicleClass), readReturnAltitude(protocol)]).then(
      ([params, rtlAlt]) => ({ ...params, rtlAltM: rtlAlt ?? undefined }),
      () => ({}),
    );
    perClass.set(vehicleClass, pending);
    const cache = perClass;
    // A read that found nothing (parameters not loaded yet) is retried by the next caller.
    void pending.then((value) => {
      if (Object.values(value).every((v) => v === undefined)) cache.delete(vehicleClass);
    });
  }
  return pending;
}

/** The selected vehicle's return altitude and flight-model parameters, kept with the link they were read from. */
function useVehicleReturnReadings(vehicleClass: PlanVehicleClass): VehicleReturnReadings {
  const protocol = useDroneManager(selectSelectedProtocol);
  const [read, setRead] = useState<{ protocol: DroneProtocol; vehicleClass: PlanVehicleClass; value: VehicleReturnReadings } | null>(null);
  useEffect(() => {
    if (!protocol) return;
    let live = true;
    void readOnce(protocol, vehicleClass).then((value) => {
      if (live) setRead({ protocol, vehicleClass, value });
    });
    return () => { live = false; };
  }, [protocol, vehicleClass]);
  return useMemo(
    () => (read && read.protocol === protocol && read.vehicleClass === vehicleClass ? read.value : {}),
    [read, protocol, vehicleClass],
  );
}

/** Everything both hooks below derive from the plan and the vehicle. */
function useReturnInputs() {
  const profile = usePlanVehicleProfile();
  const params = useVehicleReturnReadings(profile.vehicleClass);
  const rally = useRallyStore((s) => s.points);
  const fenceEnabled = useGeofenceStore((s) => s.enabled);
  const fenceMaxAltitude = useGeofenceStore((s) => s.maxAltitude);
  const returnCeilingM = fenceReturnCeiling(
    profile.autopilot,
    { enabled: fenceEnabled, maxAltitude: fenceMaxAltitude },
    params.fenceMarginM,
  );
  const rules = useMemo<RtlTargetRules>(
    () => ({
      autopilot: profile.autopilot,
      vehicleClass: profile.vehicleClass,
      rallyLimitKm: params.rallyLimitKm,
      rallyIncludeHome: params.rallyIncludeHome,
      px4RtlType: params.px4RtlType,
    }),
    [profile.autopilot, profile.vehicleClass, params.rallyLimitKm, params.rallyIncludeHome, params.px4RtlType],
  );
  return { profile, params, rally, returnCeilingM, rules };
}

/** RTL datums for `waypoints` (default: the open plan's) when the plan has no planned home. */
export function useRtlReturnContext(planWaypoints?: readonly Waypoint[]): RtlReturnContext {
  const { params, rally, returnCeilingM, rules } = useReturnInputs();
  const plannedHome = useMissionStore((s) => s.plannedHome);
  const storeWaypoints = useMissionStore((s) => s.waypoints);
  const waypoints = planWaypoints ?? storeWaypoints;

  const home = useMemo<RtlReturnContext["home"]>(() => {
    if (plannedHome) {
      return plannedHome.groundAmsl !== undefined && Number.isFinite(plannedHome.groundAmsl)
        ? { lat: plannedHome.lat, lon: plannedHome.lon, groundElevation: plannedHome.groundAmsl }
        : undefined;
    }
    // No planned home: the launch point, with the ground sampled under it.
    const launch = planLaunchPoint(waypoints);
    const wp = launch && waypoints.find((w) => w.lat === launch.lat && w.lon === launch.lon);
    return wp && wp.groundElevation !== undefined && Number.isFinite(wp.groundElevation)
      ? { lat: wp.lat, lon: wp.lon, groundElevation: wp.groundElevation }
      : undefined;
  }, [plannedHome, waypoints]);

  return useMemo(
    () => ({ home, rtlAltitude: params.rtlAltM, returnCeilingM, rally, rules }),
    [home, params.rtlAltM, returnCeilingM, rally, rules],
  );
}

/**
 * Inputs for flight-plan estimates (simulation, statistics, energy, flight
 * brief): the planned home, the plan's profile, frame and transit altitude,
 * the rally points, and what the selected vehicle reports; each vehicle value
 * `undefined` until known so the estimate falls back to firmware defaults.
 */
export function useFlightPlanOptions(): FlightPlanOptions {
  const { profile, params, rally, returnCeilingM, rules } = useReturnInputs();
  const plannedHome = useMissionStore((s) => s.plannedHome);
  const transitAltM = useMissionStore((s) => s.transitAltM);
  const defaultFrame = usePlannerStore((s) => s.defaultFrame);
  return useMemo(
    () => ({
      home: plannedHome ?? undefined,
      rtlAltM: params.rtlAltM,
      autopilot: profile.autopilot,
      vehicleClass: profile.vehicleClass,
      defaultFrame,
      transitAltM,
      climbRateMps: params.climbRateMps,
      descentRateMps: params.descentRateMps,
      landSpeedMps: params.landSpeedMps,
      landSlowAltM: params.landSlowAltM,
      rtlLoiterS: params.rtlLoiterS,
      rally,
      rallyLimitKm: rules.rallyLimitKm,
      rallyIncludeHome: rules.rallyIncludeHome,
      px4RtlType: rules.px4RtlType,
      returnCeilingM,
    }),
    [plannedHome, params, profile.autopilot, profile.vehicleClass, defaultFrame, transitAltM, rally, rules, returnCeilingM],
  );
}
