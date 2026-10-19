/**
 * @module SarConfigSections
 * @description SAR pattern configuration UIs: expanding square, sector search, parallel track.
 * Extracted from PatternConfigSections.tsx.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { MIN_LINE_SPACING_M } from "@/lib/patterns/types";
import { PropertyRow } from "@/components/ui/property-row";
import { usePatternStore } from "@/stores/pattern-store";
import { usePlannerStore } from "@/stores/planner-store";
import type { DatumPattern } from "@/lib/planner-mode";
import { Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";
import { PatternNumberRow } from "./PatternNumberRow";

/**
 * Arms datum placement for this section's search pattern, so the next map click
 * sets the search datum for THIS pattern (carried on the authoritative planner
 * mode) instead of silently intercepting plain select-mode clicks. Shows active
 * state.
 */
function SetDatumButton({ pattern }: { pattern: DatumPattern }) {
  const te = useTranslations("planner.inspector.editor");
  const armed = usePlannerStore((s) => s.activeTool === "datum");
  const armDatum = usePlannerStore((s) => s.armDatum);
  const setActiveTool = usePlannerStore((s) => s.setActiveTool);
  return (
    <button
      type="button"
      aria-pressed={armed}
      onClick={() => (armed ? setActiveTool("select") : armDatum(pattern))}
      className={cn(
        "flex h-7 w-full items-center justify-center gap-2 rounded-sm border text-xs transition-colors cursor-pointer",
        armed
          ? "border-accent-primary bg-accent-primary/15 text-accent-primary"
          : "border-border-default text-text-secondary hover:bg-bg-tertiary",
      )}
    >
      <Crosshair size={12} />
      {armed ? te("clickMapToSetPoint") : te("setOnMap")}
    </button>
  );
}

/** The search datum (or start point) as a row, or the hint to place one. */
function PointRow({ label, point, emptyHint }: { label: string; point: [number, number] | undefined; emptyHint: string }) {
  if (!point) return <p className="py-1 text-[11px] text-text-tertiary">{emptyHint}</p>;
  return (
    <PropertyRow label={label}>
      <span className="block truncate font-mono text-xs text-text-primary">
        {point[0].toFixed(4)}, {point[1].toFixed(4)}
      </span>
    </PropertyRow>
  );
}

export function SarExpandingSquareConfig() {
  const t = useTranslations("planner");
  const te = useTranslations("planner.inspector.editor");
  const config = usePatternStore((s) => s.sarExpandingSquareConfig);
  const update = usePatternStore((s) => s.updateSarExpandingSquareConfig);
  return (
    <div className="flex flex-col">
      <PointRow label={te("datum")} point={config.center} emptyHint={t("clickMapSetDatum")} />
      <SetDatumButton pattern="expandingSquare" />
      <div className="mt-1 flex flex-col">
        <PatternNumberRow label={t("legSpacing")} unit="m" step={0.1} min={MIN_LINE_SPACING_M}
          value={config.legSpacing ?? 50} onCommit={(legSpacing) => update({ legSpacing })} />
        <PatternNumberRow label={t("maxLegs")} step={1} min={1} precision={0}
          value={config.maxLegs ?? 20} onCommit={(maxLegs) => update({ maxLegs })} />
        <PatternNumberRow label={t("startBearing")} unit="deg" step={1} min={0} max={360}
          value={config.startBearing ?? 0} onCommit={(startBearing) => update({ startBearing })} />
        <PatternNumberRow label={t("altitudeAboveHome")} unit="m" step={1} min={1}
          value={config.altitude ?? 50} onCommit={(altitude) => update({ altitude })} />
        <PatternNumberRow label={t("speed")} unit="m/s" step={0.5} min={0.1}
          value={config.speed ?? 5} onCommit={(speed) => update({ speed })} />
      </div>
    </div>
  );
}

export function SarSectorSearchConfig() {
  const t = useTranslations("planner");
  const te = useTranslations("planner.inspector.editor");
  const config = usePatternStore((s) => s.sarSectorSearchConfig);
  const update = usePatternStore((s) => s.updateSarSectorSearchConfig);
  return (
    <div className="flex flex-col">
      <PointRow label={te("datum")} point={config.center} emptyHint={t("clickMapSetDatum")} />
      <SetDatumButton pattern="sectorSearch" />
      <div className="mt-1 flex flex-col">
        <PatternNumberRow label={t("searchRadius")} unit="m" step={5} min={1}
          value={config.radius ?? 200} onCommit={(radius) => update({ radius })} />
        <PatternNumberRow label={t("sweeps")} step={1} min={1} precision={0}
          value={config.sweeps ?? 3} onCommit={(sweeps) => update({ sweeps })} />
        <PatternNumberRow label={t("startBearing")} unit="deg" step={1} min={0} max={360}
          value={config.startBearing ?? 0} onCommit={(startBearing) => update({ startBearing })} />
        <PatternNumberRow label={t("altitudeAboveHome")} unit="m" step={1} min={1}
          value={config.altitude ?? 50} onCommit={(altitude) => update({ altitude })} />
        <PatternNumberRow label={t("speed")} unit="m/s" step={0.5} min={0.1}
          value={config.speed ?? 5} onCommit={(speed) => update({ speed })} />
      </div>
    </div>
  );
}

export function SarParallelTrackConfig() {
  const t = useTranslations("planner");
  const te = useTranslations("planner.inspector.editor");
  const config = usePatternStore((s) => s.sarParallelTrackConfig);
  const update = usePatternStore((s) => s.updateSarParallelTrackConfig);
  return (
    <div className="flex flex-col">
      <PointRow label={te("start")} point={config.startPoint} emptyHint={t("clickMapSetStart")} />
      <SetDatumButton pattern="parallelTrack" />
      <div className="mt-1 flex flex-col">
        <PatternNumberRow label={t("trackLength")} unit="m" step={10} min={1}
          value={config.trackLength ?? 500} onCommit={(trackLength) => update({ trackLength })} />
        <PatternNumberRow label={t("trackSpacing")} unit="m" step={0.1} min={MIN_LINE_SPACING_M}
          value={config.trackSpacing ?? 50} onCommit={(trackSpacing) => update({ trackSpacing })} />
        <PatternNumberRow label={t("trackCount")} step={1} min={1} precision={0}
          value={config.trackCount ?? 10} onCommit={(trackCount) => update({ trackCount })} />
        <PatternNumberRow label={t("bearing")} unit="deg" step={1} min={0} max={360}
          value={config.bearing ?? 0} onCommit={(bearing) => update({ bearing })} />
        <PatternNumberRow label={t("altitudeAboveHome")} unit="m" step={1} min={1}
          value={config.altitude ?? 50} onCommit={(altitude) => update({ altitude })} />
        <PatternNumberRow label={t("speed")} unit="m/s" step={0.5} min={0.1}
          value={config.speed ?? 5} onCommit={(speed) => update({ speed })} />
      </div>
    </div>
  );
}
