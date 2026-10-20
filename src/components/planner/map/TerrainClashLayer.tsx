/**
 * @module TerrainClashLayer
 * @description Legs that pass too close to or through the terrain, drawn red
 * over the path from the planner's shared validation result (the one behind
 * the bar's issue chip, so nothing is validated twice). Hovering names the
 * clearance; a click selects the leg's start waypoint and opens the Issues tab.
 * Must render inside a react-leaflet MapContainer.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Polyline, Tooltip } from "react-leaflet";
import { MAP_COLORS } from "@/lib/map-constants";
import { usePlannerValidation } from "@/hooks/use-planner-validation";
import { usePlannerStore } from "@/stores/planner-store";
import type { Waypoint } from "@/lib/types";

const CLASH_STYLE = { color: MAP_COLORS.fence, weight: 4, opacity: 0.9, bubblingMouseEvents: false };

/** Select the clashing leg's start waypoint and show it in the Issues tab. */
function showClash(waypointId: string): void {
  const planner = usePlannerStore.getState();
  planner.clearMultiSelection();
  planner.setSelectedWaypoint(waypointId);
  planner.setDock("issues", true);
}

export function TerrainClashLayer({ waypoints }: { waypoints: Waypoint[] }) {
  const t = useTranslations("planner.map");
  const validation = usePlannerValidation(waypoints);
  const clashes = useMemo(() => {
    if (!validation) return [];
    const byId = new Map(waypoints.map((w) => [w.id, w]));
    return [...validation.errors, ...validation.warnings].flatMap((issue) => {
      if (issue.code !== "LEG_TERRAIN_CLEARANCE" || !issue.leg || !issue.waypointId) return [];
      const from = byId.get(issue.waypointId);
      const to = byId.get(issue.leg.toWaypointId);
      if (!from || !to) return [];
      return [{
        key: `clash-${from.id}-${to.id}`,
        fromId: from.id,
        positions: [[from.lat, from.lon], [to.lat, to.lon]] as [number, number][],
        clearanceM: issue.leg.clearanceM,
      }];
    });
  }, [validation, waypoints]);

  return (
    <>
      {clashes.map((c) => (
        <Polyline
          key={c.key}
          positions={c.positions}
          pathOptions={CLASH_STYLE}
          eventHandlers={{ click: () => showClash(c.fromId) }}
        >
          <Tooltip sticky>
            {c.clearanceM < 0
              ? t("clipsTerrain", { m: Math.round(-c.clearanceM) })
              : t("lowOverTerrain", { m: Math.round(c.clearanceM) })}
          </Tooltip>
        </Polyline>
      ))}
    </>
  );
}
