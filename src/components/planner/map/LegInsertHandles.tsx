/**
 * @module LegInsertHandles
 * @description A small hollow "+" at the midpoint of every drawn leg. A click
 * inserts a waypoint there; dragging the handle inserts it where it is dropped.
 * The new waypoint flies at the preceding waypoint's altitude and frame. Shown
 * in select mode from zoom 15 only, and never while drawing or measuring. Must
 * render inside a react-leaflet MapContainer.
 * @license GPL-3.0-only
 */
"use client";

import { memo, useMemo } from "react";
import { useTranslations } from "next-intl";
import L from "leaflet";
import { Marker } from "react-leaflet";
import { MAP_COLORS } from "@/lib/map-constants";
import { waypointForInsert } from "@/app/plan/use-planner-actions";
import { useMissionStore } from "@/stores/mission-store";
import type { Waypoint } from "@/lib/types";

/** Handles are hidden below this zoom, where legs are too short to aim at. */
export const LEG_HANDLE_MIN_ZOOM = 15;

const handleIcon = L.divIcon({
  className: "",
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  html: `<svg width="16" height="16" viewBox="0 0 16 16" style="cursor:copy">
      <circle cx="8" cy="8" r="6.5" fill="${MAP_COLORS.background}" fill-opacity="0.35" stroke="${MAP_COLORS.accentPrimary}" stroke-width="1.5"/>
      <path d="M8 5 V11 M5 8 H11" stroke="${MAP_COLORS.accentPrimary}" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,
});

/** Insert a waypoint before planner index `index`, flying at the preceding waypoint's altitude and frame. */
function insertAt(index: number, at: { lat: number; lon: number }): void {
  const prev = useMissionStore.getState().waypoints[index - 1];
  if (!prev) return;
  useMissionStore.getState().insertWaypoint(waypointForInsert(prev, at), index);
}

/** A point the map draws a leg to: an item with its own position. */
const hasPosition = (wp: Waypoint) => !wp.inheritsPosition && !(wp.lat === 0 && wp.lon === 0);

interface LegInsertHandlesProps {
  waypoints: Waypoint[];
  zoom: number;
  /** Select mode with no draw or measure in progress. */
  enabled: boolean;
}

export const LegInsertHandles = memo(function LegInsertHandles({ waypoints, zoom, enabled }: LegInsertHandlesProps) {
  const t = useTranslations("planner.map");
  const visible = enabled && zoom >= LEG_HANDLE_MIN_ZOOM;
  const handles = useMemo(() => {
    if (!visible) return [];
    const out: { key: string; index: number; position: [number, number] }[] = [];
    for (let i = 1; i < waypoints.length; i++) {
      const a = waypoints[i - 1];
      const b = waypoints[i];
      if (!hasPosition(a) || !hasPosition(b)) continue;
      out.push({ key: `ins-${a.id}-${b.id}`, index: i, position: [(a.lat + b.lat) / 2, (a.lon + b.lon) / 2] });
    }
    return out;
  }, [visible, waypoints]);

  return (
    <>
      {handles.map((h) => (
        <Marker
          key={h.key}
          position={h.position}
          icon={handleIcon}
          title={t("insertWaypoint")}
          draggable
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e);
              insertAt(h.index, { lat: h.position[0], lon: h.position[1] });
            },
            dragend: (e) => {
              const ll = e.target.getLatLng();
              insertAt(h.index, { lat: ll.lat, lon: ll.lng });
            },
          }}
        />
      ))}
    </>
  );
});
