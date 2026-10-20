/**
 * @module CursorTracker
 * @description In-map tracker that reports the cursor's map coordinate to the
 * bottom-right coordinate widget. Lives inside the MapContainer so
 * `useMapEvents` has the leaflet context, renders nothing, and dispatches a
 * lightweight DOM CustomEvent (a null payload on mouse-out) rather than routing
 * a per-move value through a store.
 * @license GPL-3.0-only
 */
"use client";

import { useMapEvents } from "react-leaflet";
import { CURSOR_MOVE_EVENT } from "@/lib/planner/cursor-coord";

export function CursorTracker() {
  useMapEvents({
    mousemove(e) {
      window.dispatchEvent(
        new CustomEvent(CURSOR_MOVE_EVENT, { detail: { lat: e.latlng.lat, lon: e.latlng.lng } }),
      );
    },
    mouseout() {
      window.dispatchEvent(new CustomEvent(CURSOR_MOVE_EVENT, { detail: null }));
    },
  });
  return null;
}
