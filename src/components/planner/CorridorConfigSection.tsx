/**
 * @module CorridorConfigSection
 * @description Corridor pattern configuration UI.
 * Extracted from PatternConfigSections.tsx.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { MIN_LINE_SPACING_M } from "@/lib/patterns/types";
import { usePatternStore } from "@/stores/pattern-store";
import { usePlannerStore } from "@/stores/planner-store";
import { PenLine } from "lucide-react";
import { PatternNumberRow } from "./PatternNumberRow";

export function CorridorConfig() {
  const t = useTranslations("planner");
  const corridorConfig = usePatternStore((s) => s.corridorConfig);
  const updateCorridorConfig = usePatternStore((s) => s.updateCorridorConfig);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] text-text-tertiary">
        {corridorConfig.pathPoints
          ? `${corridorConfig.pathPoints.length} ${t("pathPoints")}`
          : t("drawCorridorHint")}
      </p>
      {/* Arm a polygon draw tagged for the pattern, so the completed line feeds
          the corridor centerline (routed by the draw-mode destination tag). */}
      <button
        type="button"
        onClick={() => usePlannerStore.getState().setMode({ kind: "draw", shape: "polygon", drawingFor: "pattern" })}
        className="flex h-7 w-full items-center justify-center gap-2 rounded-sm border border-border-default text-xs
          text-text-secondary hover:bg-bg-tertiary transition-colors cursor-pointer"
      >
        <PenLine size={12} />
        {t("drawCorridorPath")}
      </button>
      <div className="flex flex-col">
        <PatternNumberRow label={t("corridorWidth")} unit="m" step={1} min={1} value={corridorConfig.corridorWidth ?? 50}
          onCommit={(corridorWidth) => updateCorridorConfig({ corridorWidth })} />
        <PatternNumberRow label={t("lineSpacing")} unit="m" step={0.1} min={MIN_LINE_SPACING_M} value={corridorConfig.lineSpacing ?? 20}
          onCommit={(lineSpacing) => updateCorridorConfig({ lineSpacing })} />
        <PatternNumberRow label={t("altitudeAboveHome")} unit="m" step={1} min={1} value={corridorConfig.altitude ?? 50}
          onCommit={(altitude) => updateCorridorConfig({ altitude })} />
        <PatternNumberRow label={t("speed")} unit="m/s" step={0.5} min={0.1} value={corridorConfig.speed ?? 5}
          onCommit={(speed) => updateCorridorConfig({ speed })} />
      </div>
    </div>
  );
}
