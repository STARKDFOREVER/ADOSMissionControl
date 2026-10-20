/**
 * @module ImplicitLegsLayer
 * @description The legs the vehicle flies that are not drawn between two
 * planner items: home to the first item, the transit legs at the transit
 * altitude, and the RTL leg back to the return point. Thin dashed lines, so the
 * distance in the dock visibly includes them; a transit leg carries its height
 * ("↑ 120 m"). Read from the shared flight plan, never recomputed. Must render
 * inside a react-leaflet MapContainer.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Marker, Polyline } from "react-leaflet";
import { MAP_COLORS } from "@/lib/map-constants";
import { usePlannerFlightPlan } from "@/hooks/use-planner-flight-plan";
import { useMissionStore } from "@/stores/mission-store";
import { makeSegmentLabel } from "../planner-map-helpers";

const IMPLICIT_LEG_STYLE = { color: MAP_COLORS.accentPrimary, weight: 1.5, dashArray: "2 6", opacity: 0.7, interactive: false };

/** Shorter than this is a vertical segment drawn as a point; not a leg. */
const MIN_LEG_M = 0.5;

export function ImplicitLegsLayer() {
  const t = useTranslations("planner.map");
  const plan = usePlannerFlightPlan();
  const transitOn = useMissionStore((s) => s.transitAltM !== null);
  const legs = useMemo(
    () =>
      plan.segments
        .filter((s) => s.implicit && s.distance >= MIN_LEG_M)
        .map((s, i) => ({
          key: `implicit-${i}-${s.kind}-${s.fromIndex}-${s.toIndex}`,
          positions: [[s.from.lat, s.from.lon], [s.to.lat, s.to.lon]] as [number, number][],
          mid: [(s.from.lat + s.to.lat) / 2, (s.from.lon + s.to.lon) / 2] as [number, number],
          // Transit legs, and with a transit altitude the way back, are flown
          // level at the height they arrive at.
          transitAltM: s.kind === "transit" || (transitOn && s.kind === "return") ? Math.round(s.to.alt) : null,
        })),
    [plan, transitOn],
  );
  return (
    <>
      {legs.map((leg) => (
        <Polyline key={leg.key} positions={leg.positions} pathOptions={IMPLICIT_LEG_STYLE} />
      ))}
      {legs.map((leg) =>
        leg.transitAltM !== null ? (
          <Marker key={`${leg.key}-label`} position={leg.mid} icon={makeSegmentLabel(t("transitAlt", { m: leg.transitAltM }))} interactive={false} />
        ) : null,
      )}
    </>
  );
}
