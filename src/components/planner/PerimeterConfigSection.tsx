/**
 * @module PerimeterConfigSection
 * @description Perimeter (boundary loop) pattern configuration UI: one closed
 * pass around the drawn polygon, optionally inset by a fixed offset.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { usePatternStore } from "@/stores/pattern-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { Pentagon } from "lucide-react";

export function PerimeterConfig() {
  const t = useTranslations("planner");
  const perimeterConfig = usePatternStore((s) => s.perimeterConfig);
  const updatePerimeterConfig = usePatternStore((s) => s.updatePerimeterConfig);
  const polygonCount = useDrawingStore((s) => s.polygons.length);
  const hasArea = (perimeterConfig.polygon?.length ?? 0) >= 3 || polygonCount > 0;
  return (
    <>
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-text-tertiary">
        <Pentagon size={12} />
        <span>{hasArea ? t("perimeterAreaSet") : t("drawPolygonFirst")}</span>
      </div>
      <Input label={t("perimeterOffset")} type="number" unit="m" min={0} step={0.5}
        value={String(perimeterConfig.offsetM ?? 0)}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          updatePerimeterConfig({ offsetM: Number.isFinite(v) && v > 0 ? v : 0 });
        }} />
      <div className="grid grid-cols-2 gap-2">
        <Input label={t("altitudeAboveHome")} type="number" unit="m" value={String(perimeterConfig.altitude ?? 50)}
          onChange={(e) => updatePerimeterConfig({ altitude: parseFloat(e.target.value) || 50 })} />
        <Input label={t("speedMs")} type="number" unit="m/s" value={String(perimeterConfig.speed ?? 5)}
          onChange={(e) => updatePerimeterConfig({ speed: parseFloat(e.target.value) || 5 })} />
      </div>
    </>
  );
}
