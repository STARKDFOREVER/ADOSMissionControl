/**
 * @module planned-home
 * @description The one-shot "pick the planned home on the map" mode: the
 * armed map click that sets the home, and Escape to cancel it. The ground
 * under a new home is filled in by the planned-home seed, which samples a
 * home that has no ground elevation.
 * @license GPL-3.0-only
 */
"use client";

import { useEffect } from "react";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";

/** A longitude Leaflet reports past ±180 after panning across the antimeridian, wrapped back. */
function wrapLon(lon: number): number {
  if (lon >= -180 && lon <= 180) return lon;
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Set the planned home at a map click (one undo step) and leave pick mode. */
export function pickPlannedHome(lat: number, lon: number): void {
  useMissionStore.getState().setPlannedHome({ lat, lon: wrapLon(lon) });
  usePlannerStore.getState().setHomePickArmed(false);
}

/**
 * While pick mode is armed, Escape cancels it. The listener runs in the capture
 * phase and marks the key handled, so the planner's own Escape (which clears
 * the selection or the tool) does not also act.
 */
export function useHomePickEscape(): void {
  const armed = usePlannerStore((s) => s.homePickArmed);
  useEffect(() => {
    if (!armed) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      usePlannerStore.getState().setHomePickArmed(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [armed]);
}
