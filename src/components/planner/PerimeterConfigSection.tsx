/**
 * @module PerimeterConfigSection
 * @description Perimeter (boundary loop) pattern configuration UI: one closed
 * pass around the drawn polygon, optionally inset by a fixed offset.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { usePatternStore } from "@/stores/pattern-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { PatternNumberRow } from "./PatternNumberRow";

export function PerimeterConfig() {
  const t = useTranslations("planner");
  const perimeterConfig = usePatternStore((s) => s.perimeterConfig);
  const updatePerimeterConfig = usePatternStore((s) => s.updatePerimeterConfig);
  const polygonCount = useDrawingStore((s) => s.polygons.length);
  const hasArea = (perimeterConfig.polygon?.length ?? 0) >= 3 || polygonCount > 0;
  return (
    <div className="flex flex-col">
      <p className="py-1 text-[11px] text-text-tertiary">
        {hasArea ? t("perimeterAreaSet") : t("drawPolygonFirst")}
      </p>
      <PatternNumberRow label={t("perimeterOffset")} unit="m" step={0.5} min={0}
        value={perimeterConfig.offsetM ?? 0}
        onCommit={(offsetM) => updatePerimeterConfig({ offsetM })} />
      <PatternNumberRow label={t("altitudeAboveHome")} unit="m" step={1} min={1} value={perimeterConfig.altitude ?? 50}
        onCommit={(altitude) => updatePerimeterConfig({ altitude })} />
      <PatternNumberRow label={t("speed")} unit="m/s" step={0.5} min={0.1} value={perimeterConfig.speed ?? 5}
        onCommit={(speed) => updatePerimeterConfig({ speed })} />
    </div>
  );
}
