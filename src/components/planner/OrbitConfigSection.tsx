/**
 * @module OrbitConfigSection
 * @description Orbit pattern configuration UI.
 * Extracted from PatternConfigSections.tsx.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { RotateCw, RotateCcw } from "lucide-react";
import { PropertyRow } from "@/components/ui/property-row";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { usePatternStore } from "@/stores/pattern-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { PatternNumberRow } from "./PatternNumberRow";

export function OrbitConfig() {
  const t = useTranslations("planner");
  const te = useTranslations("planner.inspector.editor");
  const orbitConfig = usePatternStore((s) => s.orbitConfig);
  const updateOrbitConfig = usePatternStore((s) => s.updateOrbitConfig);
  const drawnCircles = useDrawingStore((s) => s.circles);
  // Short labels so both segments fit the inspector; the full words are the title.
  const directionOptions = useMemo(() => [
    { value: "cw" as const, label: te("directionCwShort"), title: te("directionCw"), icon: <RotateCw size={11} /> },
    { value: "ccw" as const, label: te("directionCcwShort"), title: te("directionCcw"), icon: <RotateCcw size={11} /> },
  ], [te]);
  return (
    <div className="flex flex-col">
      {orbitConfig.center ? (
        <PropertyRow label={te("center")}>
          <span className="block truncate font-mono text-xs text-text-primary">
            {orbitConfig.center[0].toFixed(4)}, {orbitConfig.center[1].toFixed(4)}
          </span>
        </PropertyRow>
      ) : (
        <p className="py-1 text-[11px] text-text-tertiary">
          {drawnCircles.length > 0 ? t("usingLastDrawnCircle") : t("drawCircleFirst")}
        </p>
      )}
      <PatternNumberRow label={t("radius")} unit="m" step={1} min={1} value={orbitConfig.radius ?? 50}
        onCommit={(radius) => updateOrbitConfig({ radius })} />
      <PropertyRow label={t("direction")}>
        <SegmentedControl size="sm" stretch ariaLabel={t("direction")} options={directionOptions}
          value={orbitConfig.direction ?? "cw"}
          onChange={(direction) => updateOrbitConfig({ direction })} />
      </PropertyRow>
      <PatternNumberRow label={t("turns")} step={1} min={1} precision={0} value={orbitConfig.turns ?? 1}
        onCommit={(turns) => updateOrbitConfig({ turns })} />
      <PatternNumberRow label={t("startAngle")} unit="deg" step={1} min={0} max={360}
        hint={te("startAngleHint")} value={orbitConfig.startAngle ?? 0}
        onCommit={(startAngle) => updateOrbitConfig({ startAngle })} />
      <PatternNumberRow label={t("altitudeAboveHome")} unit="m" step={1} min={1} value={orbitConfig.altitude ?? 50}
        onCommit={(altitude) => updateOrbitConfig({ altitude })} />
      <PatternNumberRow label={t("speed")} unit="m/s" step={0.5} min={0.1} value={orbitConfig.speed ?? 5}
        onCommit={(speed) => updateOrbitConfig({ speed })} />
      <PatternNumberRow label={t("orbitTargetHeight")} unit="m" step={1} min={0} value={orbitConfig.targetHeight ?? 0}
        onCommit={(targetHeight) => updateOrbitConfig({ targetHeight })} />
    </div>
  );
}
