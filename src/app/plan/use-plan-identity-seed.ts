/**
 * @module use-plan-identity-seed
 * @description Keeps the planner's page-state name and vehicle in step with
 * the plan the library has open.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { usePlanLibraryStore } from "@/stores/plan-library-store";

/**
 * The plan name and vehicle live in page state, so a remount (a reload, a
 * route change) starts them empty while the library still has a plan open.
 * When a plan becomes active from nothing (first mount, or the library
 * hydrating after mount) its name and vehicle only fill fields the page left
 * empty, so a name the page already holds (a share link, a recovered
 * autosave) is kept. A switch from one plan to another made outside the
 * library's own load path (demo sync, a loader detaching, deleting the open
 * plan) replaces the name and vehicle, and closing the plan clears them.
 */
export function usePlanIdentitySeed(
  activePlanId: string | null,
  setMissionName: Dispatch<SetStateAction<string>>,
  setSelectedDroneId: Dispatch<SetStateAction<string>>,
): void {
  // Last plan id seen; `undefined` before the first run.
  const seededFor = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const previous = seededFor.current;
    if (previous === activePlanId) return;
    seededFor.current = activePlanId;

    if (activePlanId === null) {
      if (previous !== undefined) {
        setMissionName("");
        setSelectedDroneId("");
      }
      return;
    }

    // An active id the library does not hold names no plan to take identity from.
    const plan = usePlanLibraryStore.getState().plans.find((pl) => pl.id === activePlanId);
    if (!plan) return;
    if (previous === undefined || previous === null) {
      setMissionName((current) => current || plan.name);
      const droneId = plan.metadata.droneId;
      if (droneId) setSelectedDroneId((current) => current || droneId);
      return;
    }
    setMissionName(plan.name);
    setSelectedDroneId(plan.metadata.droneId ?? "");
  }, [activePlanId, setMissionName, setSelectedDroneId]);
}
