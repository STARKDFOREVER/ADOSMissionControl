/**
 * @module LandingPointPicker
 * @description Reusable landing-point coordinate picker for the landing pattern
 * config sections. Provides numeric latitude/longitude rows plus a
 * "Use map center" button that reads the current planner map center.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { usePlannerStore } from "@/stores/planner-store";
import { Crosshair } from "lucide-react";
import { PatternNumberRow } from "./PatternNumberRow";

interface LandingPointPickerProps {
  /** Current landing point as [lat, lon], or undefined when not yet set. */
  landingPoint: [number, number] | undefined;
  /** Called with the next [lat, lon] whenever either coordinate changes. */
  onChange: (point: [number, number]) => void;
}

export function LandingPointPicker({ landingPoint, onChange }: LandingPointPickerProps) {
  const t = useTranslations("planner");

  const lat = landingPoint?.[0];
  const lon = landingPoint?.[1];

  // A coordinate entered before the point exists pairs with the map centre's
  // other coordinate rather than 0 (the equator / prime meridian).
  const setLat = (v: number) => {
    onChange([v, lon ?? usePlannerStore.getState().mapCenter[1]]);
  };
  const setLon = (v: number) => {
    onChange([lat ?? usePlannerStore.getState().mapCenter[0], v]);
  };
  const useMapCenter = () => {
    const center = usePlannerStore.getState().mapCenter;
    onChange([center[0], center[1]]);
  };

  return (
    <div className="flex flex-col gap-1 pb-1">
      {!landingPoint && <p className="text-[11px] text-text-tertiary">{t("setLandingPoint")}</p>}
      <div className="flex flex-col">
        <PatternNumberRow label={t("lat")} value={lat} min={-90} max={90} step={0.00001} precision={7}
          placeholder="—" onCommit={setLat} />
        <PatternNumberRow label={t("lon")} value={lon} min={-180} max={180} step={0.00001} precision={7}
          placeholder="—" onCommit={setLon} />
      </div>
      <button
        type="button"
        onClick={useMapCenter}
        className="flex h-7 w-full items-center justify-center gap-2 rounded-sm border border-border-default text-xs
          text-text-secondary hover:bg-bg-tertiary transition-colors cursor-pointer"
      >
        <Crosshair size={12} />
        {t("useMapCenter")}
      </button>
    </div>
  );
}
