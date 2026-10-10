/**
 * @module drone-selection-reset
 * @description The single-slot and per-drone state the drone manager resets
 * when the selection moves, a drone is removed, or the whole fleet is
 * cleared. Kept apart from the manager so the lifecycle code reads as the
 * lifecycle and the fan-out list lives in one place.
 * @license GPL-3.0-only
 */

import { useTelemetryStore } from "./telemetry-store";
import { useDroneStore } from "./drone-store";
import { useVideoStore } from "./video-store";
import { useVideoStreamsStore } from "./video-streams-store";
import { useAgentCapabilitiesStore } from "./agent-capabilities-store";
import { useTrailStore } from "./trail-store";
import { usePrearmBufferStore } from "./prearm-buffer-store";
import { useGroundStationStore } from "./ground-station-store";
import { useGeofenceStore } from "./geofence-store";
import { usePanelCacheStore } from "./panel-cache-store";
import { useUploadReceiptsStore } from "./upload-receipts-store";
import { useMissionStore } from "./mission-store";
import { useChecklistStore } from "./checklist-store";
import { invalidateParamList } from "./param-list-cache";
import { forgetInavConfigStores } from "./inav-config-binding";

/**
 * The selection moved to a different drone: clear cross-drone singleton state
 * so the newly selected drone never shows the previous one's data before its
 * first frame arrives.
 */
export function resetForSelectionChange(previousId: string | null): void {
  useTelemetryStore.getState().clear();
  // The trail ring is single-slot global state written under the same
  // selection gate as the telemetry rings, so it clears on the same
  // transition; otherwise the new drone inherits the previous track and home.
  useTrailStore.getState().clear();
  // The checklist session is per drone: the leaving drone's ticks and
  // verdicts must not read as the new drone's readiness.
  useChecklistStore.getState().resetSession();
  // Nothing has been measured for the new selection: arm state and mode read
  // unknown and the previous heartbeat must not age into a LINK STALE.
  useDroneStore.getState().resetForSelection();
  // FENCE_STATUS is latched; the FC stops sending it once a breach clears,
  // so a previous drone's breach would stay lit over the new aircraft.
  useGeofenceStore.getState().clearBreachState();
  // Mission progress is the previous drone's MISSION_CURRENT.
  useMissionStore.setState({ currentWaypoint: null, progress: 0 });
  if (previousId) usePanelCacheStore.getState().clearForDrone(previousId);
  // Global single-value stores: the video pipeline, the per-agent
  // capabilities and the ground-station snapshot.
  useVideoStore.getState().clearForSelection();
  useAgentCapabilitiesStore.getState().clear();
  useGroundStationStore.getState().resetAll();
  // The per-drone stream switcher drives the video override just cleared;
  // drop the leaving drone's switcher so a return starts at its primary leg.
  if (previousId) useVideoStreamsStore.getState().clearForDevice(previousId);
}

/**
 * A drone's session went away. `wasSelected` is whether it was the selected
 * drone at removal: the singleton telemetry ring, trail and latched breach
 * only ever hold the selected drone's state, so a background removal must not
 * wipe the drone the operator is watching.
 */
export function resetForRemovedDrone(id: string, wasSelected: boolean): void {
  if (wasSelected) {
    useTelemetryStore.getState().clear();
    useTrailStore.getState().clear();
    useGeofenceStore.getState().clearBreachState();
  }
  usePanelCacheStore.getState().clearForDrone(id);
  // Its downloaded parameter list described the link that just went away.
  invalidateParamList(id);
  // The prearm STATUSTEXT buffer otherwise drains only on arm.
  usePrearmBufferStore.getState().clearForDrone(id);
  // After a disconnect the GCS no longer knows what the FC holds, so it stops
  // vouching for any mission, fence or rally upload to this drone.
  useUploadReceiptsStore.getState().clearForDrone(id);
  forgetInavConfigStores(id);
}

/** The selected node has no session any more: decay its flight state. */
export function resetSelectedFlightState(): void {
  useDroneStore.getState().setConnectionState("disconnected");
  // Heartbeat age, arm state and mode are claims about a link the GCS no
  // longer has; decay them the way a link loss does.
  useDroneStore.setState({ lastHeartbeat: 0, armState: "unknown", flightMode: "UNKNOWN" });
}

/** The whole fleet was torn down. */
export function resetAllDroneState(droneIds: Iterable<string>): void {
  for (const id of droneIds) {
    useUploadReceiptsStore.getState().clearForDrone(id);
    forgetInavConfigStores(id);
  }
  invalidateParamList();
  useDroneStore.getState().resetForSelection();
  useTelemetryStore.getState().clear();
  useTrailStore.getState().clear();
  usePrearmBufferStore.getState().clearAll();
  useChecklistStore.getState().resetSession();
  useGeofenceStore.getState().clearBreachState();
}
