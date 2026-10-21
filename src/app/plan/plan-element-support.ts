/**
 * @module plan-element-support
 * @description Which plan elements the planner offers for the selected
 * vehicle. Fence and rally hide only when a selected, connected vehicle lacks
 * them; with no vehicle selected (connected drones but none picked, or none at
 * all) the plan can carry both.
 * @license GPL-3.0-only
 */

import type { ProtocolCapabilities } from "@/lib/protocol/types";

export function planElementSupport(
  vehicleSelected: boolean,
  supports: (cap: keyof ProtocolCapabilities) => boolean,
): { showGeofence: boolean; showRally: boolean } {
  return {
    showGeofence: !vehicleSelected || supports("supportsGeoFence"),
    showRally: !vehicleSelected || supports("supportsRally"),
  };
}
