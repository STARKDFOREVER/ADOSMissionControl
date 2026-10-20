/**
 * @module FacadeConfigSection
 * @description Facade (vertical) scan configuration UI: the wall's base line
 * drawn as a two-point line, the side to fly on, distance from the wall,
 * bottom and top rows, and camera-driven or manual row and trigger spacing.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { PenLine } from "lucide-react";
import { PropertyRow } from "@/components/ui/property-row";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { usePatternStore } from "@/stores/pattern-store";
import { usePlannerStore } from "@/stores/planner-store";
import { haversineDistance } from "@/lib/geo/distance";
import { MIN_LINE_SPACING_M, type FacadeConfig as FacadeConfigType } from "@/lib/patterns/types";
import { PatternNumberRow } from "./PatternNumberRow";
import { PatternCameraRows } from "./PatternCameraRows";
import { usePatternCamera } from "./pattern-camera";
import { HoverCaptureRow, useHeightLabel } from "./PatternAltitudeSection";

export function FacadeConfig() {
  const t = useTranslations("planner");
  const tf = useTranslations("planner.pattern.facade");
  const te = useTranslations("planner.inspector.editor");
  const config = usePatternStore((s) => s.facadeConfig);
  const update = usePatternStore((s) => s.updateFacadeConfig);
  const distance = config.distance ?? 20;
  const { camera, apply } = usePatternCamera<Partial<FacadeConfigType>>(config, "facade", distance, update);
  const setHover = useCallback((hoverAndCapture: boolean) => update({ hoverAndCapture }), [update]);
  const heightLabel = useHeightLabel(config);
  const line = config.pathPoints;
  const lengthM = line && line.length >= 2 ? haversineDistance(line[0][0], line[0][1], line[1][0], line[1][1]) : null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] text-text-tertiary">
        {lengthM !== null ? tf("lineSet", { length: Math.round(lengthM) }) : tf("drawHint")}
      </p>
      <button
        type="button"
        onClick={() => usePlannerStore.getState().setMode({ kind: "draw", shape: "polyline", drawingFor: "pattern" })}
        className="flex h-7 w-full items-center justify-center gap-2 rounded-sm border border-border-default text-xs
          text-text-secondary hover:bg-bg-tertiary transition-colors cursor-pointer"
      >
        <PenLine size={12} />
        {tf("drawLine")}
      </button>
      <div className="flex flex-col">
        <PropertyRow label={tf("side")} hint={tf("sideHint")}>
          <SegmentedControl<"left" | "right"> size="sm" stretch ariaLabel={tf("side")}
            options={[{ value: "left", label: tf("left") }, { value: "right", label: tf("right") }]}
            value={config.side ?? "right"} onChange={(side) => update({ side })} />
        </PropertyRow>
        <PatternNumberRow label={tf("distance")} unit="m" step={1} min={1}
          value={distance} onCommit={(d) => apply({ distance: d }, d)} />
        <PatternNumberRow label={tf("bottomAlt")} hint={heightLabel} unit="m" step={1} min={0}
          value={config.bottomAlt ?? 10} onCommit={(bottomAlt) => update({ bottomAlt })} />
        <PatternNumberRow label={tf("topAlt")} hint={heightLabel} unit="m" step={1} min={1}
          value={config.topAlt ?? 40} onCommit={(topAlt) => update({ topAlt })} />
        <PatternCameraRows config={config} camera={camera} rangeM={distance}
          speed={config.speed ?? 3} triggerDistance={config.cameraTriggerDistance ?? 0}
          onChange={(u) => apply(u)} />
        {camera ? (
          <>
            <PropertyRow label={tf("rowSpacing")}>
              <span className="block truncate font-mono text-xs text-text-secondary">{config.rowSpacing ?? 10} m</span>
            </PropertyRow>
            <PropertyRow label={t("cameraTriggerDist")}>
              <span className="block truncate font-mono text-xs text-text-secondary">{config.cameraTriggerDistance ?? 0} m</span>
            </PropertyRow>
          </>
        ) : (
          <>
            <PatternNumberRow label={tf("rowSpacing")} unit="m" step={0.5} min={MIN_LINE_SPACING_M}
              value={config.rowSpacing ?? 10} onCommit={(rowSpacing) => update({ rowSpacing })} />
            <PatternNumberRow label={t("cameraTriggerDist")} hint={te("zeroIsOff")} unit="m" step={0.5} min={0}
              value={config.cameraTriggerDistance ?? 0}
              onCommit={(cameraTriggerDistance) => update({ cameraTriggerDistance })} />
          </>
        )}
        <PatternNumberRow label={t("speed")} unit="m/s" step={0.5} min={0.1}
          value={config.speed ?? 3} onCommit={(speed) => update({ speed })} />
      </div>
      <HoverCaptureRow checked={config.hoverAndCapture ?? false} onChange={setHover} />
    </div>
  );
}
