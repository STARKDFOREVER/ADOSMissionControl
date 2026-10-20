/**
 * @module use-planned-home-seed
 * @description Gives a plan without a planned home one, and fills in the
 * ground elevation of a planned home that lacks it.
 *
 * The planned home belongs to the plan. A plan that has none (an older plan, a
 * share link, a fresh plan) is seeded from the selected vehicle's reported
 * home when that home sits at the plan's site, else from the plan's launch
 * point. The ground under the home is then sampled from the elevation cache.
 * Both writes are derived, not operator edits: they add no undo step and, on
 * a plan with no unsaved edits, do not mark it unsaved.
 *
 * @license GPL-3.0-only
 */
"use client";

import { useEffect } from "react";
import { useMissionStore } from "@/stores/mission-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { isHomeNearPlan, planLaunchPoint } from "@/lib/mission/plan-home";
import { capturePlanExtras, workspaceHasUnsavedChanges } from "@/lib/plan-workspace";
import { planSnapshotString } from "@/lib/plan-snapshot";
import { getElevation } from "@/lib/terrain/terrain-provider";
import type { PlannedHome, Waypoint } from "@/lib/types";

/**
 * Where a plan with no planned home starts: the vehicle's reported home when
 * it lies within the plan-site bound of the launch point, else the launch
 * point. `null` when the plan has no launch point.
 */
export function plannedHomeSeed(
  waypoints: readonly Waypoint[],
  vehicleHome: { lat: number; lon: number } | undefined,
): { lat: number; lon: number } | null {
  const launch = planLaunchPoint(waypoints);
  if (!launch) return null;
  if (vehicleHome && isHomeNearPlan(vehicleHome, waypoints)) {
    return { lat: vehicleHome.lat, lon: vehicleHome.lon };
  }
  return launch;
}

/**
 * Write a derived planned home outside the undo timeline. A plan with no
 * unsaved edits stays clean: the saved snapshot moves with the derived value.
 */
function writeDerivedHome(home: PlannedHome): void {
  const lib = usePlanLibraryStore.getState();
  const wasClean = lib.activePlanId !== null && !workspaceHasUnsavedChanges();
  const mission = useMissionStore.getState();
  mission.setPlannedHome(home, { history: false });
  if (wasClean) lib.setSavedSnapshot(planSnapshotString(mission.waypoints, capturePlanExtras()));
}

/** Seed the open plan's planned home and sample its ground. Call once, from the planner page. */
export function usePlannedHomeSeed(): void {
  const plannedHome = useMissionStore((s) => s.plannedHome);
  // Primitives, so an edit that leaves the launch point in place re-runs nothing.
  const launchLat = useMissionStore((s) => planLaunchPoint(s.waypoints)?.lat ?? null);
  const launchLon = useMissionStore((s) => planLaunchPoint(s.waypoints)?.lon ?? null);

  useEffect(() => {
    if (plannedHome !== null || launchLat === null || launchLon === null) return;
    const vehicleHome = useTelemetryStore.getState().homePosition.latest();
    const seed = plannedHomeSeed(useMissionStore.getState().waypoints, vehicleHome);
    if (seed) writeDerivedHome(seed);
  }, [plannedHome, launchLat, launchLon]);

  const homeLat = plannedHome?.lat;
  const homeLon = plannedHome?.lon;
  const needsGround = plannedHome !== null && plannedHome.groundAmsl === undefined;
  useEffect(() => {
    if (!needsGround || homeLat === undefined || homeLon === undefined) return;
    const controller = new AbortController();
    void getElevation(homeLat, homeLon, controller.signal).then((groundAmsl) => {
      if (controller.signal.aborted || groundAmsl === null) return;
      const current = useMissionStore.getState().plannedHome;
      // The home moved or gained a ground value while the sample was in flight.
      if (!current || current.lat !== homeLat || current.lon !== homeLon || current.groundAmsl !== undefined) return;
      writeDerivedHome({ ...current, groundAmsl });
    });
    return () => controller.abort();
  }, [needsGround, homeLat, homeLon]);
}
