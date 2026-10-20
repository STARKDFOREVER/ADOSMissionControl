/**
 * @module CorridorConfigSection
 * @description Corridor pattern configuration UI: the path drawn as an open
 * line, width, camera-driven or manual line spacing, triggers and turnarounds.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { MIN_LINE_SPACING_M, type CorridorConfig as CorridorConfigType } from "@/lib/patterns/types";
import { PropertyRow } from "@/components/ui/property-row";
import { PropertySection } from "@/components/ui/property-section";
import { usePatternStore } from "@/stores/pattern-store";
import { usePlannerStore } from "@/stores/planner-store";
import { PenLine } from "lucide-react";
import { PatternNumberRow } from "./PatternNumberRow";
import { PatternCameraRows } from "./PatternCameraRows";
import { usePatternCamera } from "./pattern-camera";
import { HoverCaptureRow, useHeightLabel } from "./PatternAltitudeSection";

export function CorridorConfig() {
  const t = useTranslations("planner");
  const te = useTranslations("planner.inspector.editor");
  const corridorConfig = usePatternStore((s) => s.corridorConfig);
  const update = usePatternStore((s) => s.updateCorridorConfig);
  const heightLabel = useHeightLabel(corridorConfig);
  const altitude = corridorConfig.altitude ?? 50;
  const { camera, apply } = usePatternCamera<Partial<CorridorConfigType>>(corridorConfig, "corridor", altitude, update);
  const setHover = useCallback((hoverAndCapture: boolean) => update({ hoverAndCapture }), [update]);

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] text-text-tertiary">
        {corridorConfig.pathPoints
          ? `${corridorConfig.pathPoints.length} ${t("pathPoints")}`
          : t("drawCorridorHint")}
      </p>
      {/* Arm an open-line draw tagged for the pattern, so the completed line
          feeds the corridor centerline. */}
      <button
        type="button"
        onClick={() => usePlannerStore.getState().setMode({ kind: "draw", shape: "polyline", drawingFor: "pattern" })}
        className="flex h-7 w-full items-center justify-center gap-2 rounded-sm border border-border-default text-xs
          text-text-secondary hover:bg-bg-tertiary transition-colors cursor-pointer"
      >
        <PenLine size={12} />
        {t("drawCorridorPath")}
      </button>
      <div className="flex flex-col">
        <PatternNumberRow label={t("corridorWidth")} unit="m" step={1} min={1} value={corridorConfig.corridorWidth ?? 50}
          onCommit={(corridorWidth) => update({ corridorWidth })} />
        <PatternCameraRows config={corridorConfig} camera={camera} rangeM={altitude}
          speed={corridorConfig.speed ?? 5} triggerDistance={corridorConfig.cameraTriggerDistance ?? 0}
          onChange={(u) => apply(u)} />
        {camera ? (
          <>
            <PropertyRow label={t("lineSpacing")}>
              <span className="block truncate font-mono text-xs text-text-secondary">{corridorConfig.lineSpacing ?? 20} m</span>
            </PropertyRow>
            <PropertyRow label={t("cameraTriggerDist")}>
              <span className="block truncate font-mono text-xs text-text-secondary">{corridorConfig.cameraTriggerDistance ?? 0} m</span>
            </PropertyRow>
          </>
        ) : (
          <PatternNumberRow label={t("lineSpacing")} unit="m" step={0.1} min={MIN_LINE_SPACING_M} value={corridorConfig.lineSpacing ?? 20}
            onCommit={(lineSpacing) => update({ lineSpacing })} />
        )}
        <PatternNumberRow label={heightLabel} unit="m" step={1} min={1} value={altitude}
          onCommit={(alt) => apply({ altitude: alt }, alt)} />
        <PatternNumberRow label={t("speed")} unit="m/s" step={0.5} min={0.1} value={corridorConfig.speed ?? 5}
          onCommit={(speed) => update({ speed })} />
      </div>
      <PropertySection title={te("advanced")} collapsible defaultOpen={false} persistKey="pattern.corridor.advanced" flush>
        <PatternNumberRow label={t("turnAroundDistance")} unit="m" step={1} min={0}
          value={corridorConfig.turnAroundDistance ?? 10}
          onCommit={(turnAroundDistance) => update({ turnAroundDistance })} />
        {!camera && (
          <PatternNumberRow label={t("cameraTriggerDist")} hint={te("zeroIsOff")} unit="m" step={0.5} min={0}
            value={corridorConfig.cameraTriggerDistance ?? 0}
            onCommit={(cameraTriggerDistance) => update({ cameraTriggerDistance })} />
        )}
        <HoverCaptureRow checked={corridorConfig.hoverAndCapture ?? false} onChange={setHover} />
      </PropertySection>
    </div>
  );
}
