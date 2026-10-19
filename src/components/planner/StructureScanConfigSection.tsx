/**
 * @module StructureScanConfigSection
 * @description Structure scan pattern configuration UI.
 * Extracted from PatternConfigSections.tsx.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { PropertyRow } from "@/components/ui/property-row";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { usePatternStore } from "@/stores/pattern-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { SCAN_DIRECTION_OPTIONS } from "./pattern-editor-constants";
import { PatternNumberRow } from "./PatternNumberRow";

export function StructureScanConfig() {
  const t = useTranslations("planner");
  const te = useTranslations("planner.inspector.editor");
  const config = usePatternStore((s) => s.structureScanConfig);
  const update = usePatternStore((s) => s.updateStructureScanConfig);
  const drawnPolygons = useDrawingStore((s) => s.polygons);
  return (
    <div className="flex flex-col">
      <p className="py-1 text-[11px] text-text-tertiary">
        {config.structurePolygon
          ? t("verticesCount", { count: config.structurePolygon.length })
          : drawnPolygons.length > 0
            ? t("usingLastDrawnPolygon", { count: drawnPolygons[drawnPolygons.length - 1].vertices.length })
            : t("drawStructureBoundary")}
      </p>
      <PatternNumberRow label={t("bottomAlt")} hint={t("aboveHome")} unit="m" step={1} min={0}
        value={config.bottomAlt ?? 10} onCommit={(bottomAlt) => update({ bottomAlt })} />
      <PatternNumberRow label={t("topAlt")} hint={t("aboveHome")} unit="m" step={1} min={1}
        value={config.topAlt ?? 50} onCommit={(topAlt) => update({ topAlt })} />
      <PatternNumberRow label={t("layerSpacing")} unit="m" step={1} min={0.5}
        value={config.layerSpacing ?? 10} onCommit={(layerSpacing) => update({ layerSpacing })} />
      <PatternNumberRow label={t("scanDistance")} unit="m" step={1} min={1}
        value={config.scanDistance ?? 15} onCommit={(scanDistance) => update({ scanDistance })} />
      <PatternNumberRow label={t("gimbalPitch")} unit="deg" step={1} min={-90} max={90}
        value={config.gimbalPitch ?? -30} onCommit={(gimbalPitch) => update({ gimbalPitch })} />
      <PatternNumberRow label={t("pointsPerLayer")} step={1} min={3} precision={0}
        value={config.pointsPerLayer ?? 16} onCommit={(pointsPerLayer) => update({ pointsPerLayer })} />
      <PropertyRow label={t("direction")}>
        <SegmentedControl size="sm" stretch ariaLabel={t("direction")}
          options={SCAN_DIRECTION_OPTIONS.map((o) => ({
            value: o.value,
            label: t(o.value === "bottom-up" ? "inspector.pattern.scanDirection.bottomUp" : "inspector.pattern.scanDirection.topDown"),
          }))}
          value={config.direction ?? "bottom-up"} onChange={(direction) => update({ direction })} />
      </PropertyRow>
      <PatternNumberRow label={t("speed")} unit="m/s" step={0.5} min={0.1}
        value={config.speed ?? 3} onCommit={(speed) => update({ speed })} />
      <PatternNumberRow label={t("cameraTriggerDist")} hint={te("zeroIsOff")} unit="m" step={0.5} min={0}
        value={config.cameraTriggerDistance ?? 0}
        onCommit={(cameraTriggerDistance) => update({ cameraTriggerDistance })} />
    </div>
  );
}
