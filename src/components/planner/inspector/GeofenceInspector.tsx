/**
 * @module GeofenceInspector
 * @description Inspector body for the geofence: settings, draw on map, and
 * the fence's own upload / download / clear.
 * @license GPL-3.0-only
 */
"use client";

import { usePlannerStore } from "@/stores/planner-store";
import { GeofenceEditor } from "../GeofenceEditor";

export function GeofenceInspector() {
  return (
    <div className="px-3 py-3">
      <GeofenceEditor
        onDrawOnMap={(shape) => usePlannerStore.getState().setMode({
          kind: "draw", shape: shape === "polygon" ? "polygon" : "circle", drawingFor: "geofence",
        })}
      />
    </div>
  );
}
