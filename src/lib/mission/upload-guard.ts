/**
 * @module upload-guard
 * @description The one refusal every mission, fence and rally upload applies
 * while the target vehicle is armed and flying its mission: a new mission
 * replaces the one being flown under the vehicle, which keeps flying whatever
 * lands at its current index, and a fence or rally swap changes the limits
 * and the return point mid-flight. The state is read per target from the node
 * registry, never from the single-slot drone store, so a second drone's
 * reading never decides for the target. An unknown arm state does not block.
 * @license GPL-3.0-only
 */

import { useNodeRegistryStore } from "@/stores/node-registry";

/** The refusal text every upload path returns while the target flies its mission. */
export const MISSION_ACTIVE_REFUSAL = "Pause the mission before uploading";

/** Armed and in the mission mode: ArduPilot and PX4 report "AUTO", iNav "MISSION". */
export function isFlyingMission(armState: string | undefined, flightMode: string | undefined): boolean {
  return armState === "armed" && (flightMode === "AUTO" || flightMode === "MISSION");
}

/** MISSION_ACTIVE_REFUSAL when `droneId` is armed and flying its mission, else null. An unknown arm state passes. */
export function flyingMissionRefusal(droneId: string | null | undefined): string | null {
  if (!droneId) return null;
  const fc = useNodeRegistryStore.getState().getEntry(droneId)?.fc;
  if (!fc) return null;
  return isFlyingMission(fc.armState, fc.flightMode) ? MISSION_ACTIVE_REFUSAL : null;
}
