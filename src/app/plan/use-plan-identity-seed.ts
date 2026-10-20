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
 * On first mount they are seeded from that plan without replacing a name the
 * page already holds (a share link, a recovered autosave). After that the
 * identity follows the active plan: a switch made outside the library's own
 * load path (demo sync, a loader detaching, deleting the open plan) replaces
 * the name and vehicle, and closing the plan clears them.
 */
export function usePlanIdentitySeed(
  activePlanId: string | null,
  setMissionName: Dispatch<SetStateAction<string>>,
  setSelectedDroneId: Dispatch<SetStateAction<string>>,
): void {
  // Last plan id seeded; `undefined` until the first seed has happened.
  const seededFor = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (seededFor.current === activePlanId) return;
    const first = seededFor.current === undefined;
    seededFor.current = activePlanId;

    if (activePlanId === null) {
      if (!first) {
        setMissionName("");
        setSelectedDroneId("");
      }
      return;
    }

    const plan = usePlanLibraryStore.getState().plans.find((pl) => pl.id === activePlanId);
    if (!plan) {
      // The library has not hydrated yet; retry on the next run.
      seededFor.current = undefined;
      return;
    }
    if (first) {
      setMissionName((current) => current || plan.name);
      const droneId = plan.metadata.droneId;
      if (droneId) setSelectedDroneId((current) => current || droneId);
      return;
    }
    setMissionName(plan.name);
    setSelectedDroneId(plan.metadata.droneId ?? "");
  }, [activePlanId, setMissionName, setSelectedDroneId]);
}
