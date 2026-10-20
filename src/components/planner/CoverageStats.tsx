/**
 * @module CoverageStats
 * @description Survey coverage statistics panel. Derives image count and front
 * overlap from the camera triggers, side overlap from the configured line
 * spacing, and swept ground coverage, and flags a coverage gap when the line
 * spacing is too wide for the target side overlap.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { PropertyRow } from "@/components/ui/property-row";
import { usePatternStore } from "@/stores/pattern-store";
import type { CameraOrientation, CameraProfile } from "@/lib/patterns/gsd-calculator";
import { computeCoverageStats, detectCoverageGaps } from "@/lib/patterns/coverage";

interface CoverageStatsProps {
  camera: CameraProfile | undefined;
  altitude: number;
  /** Target side overlap as a fraction 0-1, used for the gap check. */
  minSideOverlap?: number;
  /** The line spacing the survey was generated with, metres. */
  lineSpacingM?: number;
  orientation?: CameraOrientation;
}

function formatArea(m2: number): string {
  return m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2)} m²`;
}

export function CoverageStats({ camera, altitude, minSideOverlap = 0.6, lineSpacingM, orientation }: CoverageStatsProps) {
  const t = useTranslations("survey");
  const activePatternType = usePatternStore((s) => s.activePatternType);
  const waypoints = usePatternStore((s) => s.patternResult?.waypoints);

  const data = useMemo(() => {
    if (!camera || activePatternType !== "survey" || !waypoints || waypoints.length < 2) {
      return null;
    }
    const options = { lineSpacingM, orientation };
    return {
      stats: computeCoverageStats(waypoints, camera, altitude, options),
      gaps: detectCoverageGaps(waypoints, camera, altitude, minSideOverlap, options),
    };
  }, [camera, altitude, minSideOverlap, lineSpacingM, orientation, activePatternType, waypoints]);

  if (!data) return null;
  const { stats, gaps } = data;

  const rows: Array<[string, string]> = [
    [t("coverage.images"), String(stats.imageCount)],
    [t("coverage.groundCoverage"), formatArea(stats.groundCoverageM2)],
    [t("coverage.frontOverlap"), stats.overlapFrontPct === null ? "—" : `${stats.overlapFrontPct.toFixed(0)}%`],
    [t("coverage.sideOverlap"), `${stats.overlapSidePct.toFixed(0)}%`],
    [t("coverage.lineSpacing"), `${stats.lineSpacingM.toFixed(1)} m`],
  ];

  return (
    <div className="flex flex-col">
      <span className="py-1 text-[11px] font-semibold text-text-tertiary">{t("coverage.title")}</span>
      {rows.map(([label, value]) => (
        <PropertyRow key={label} label={label}>
          <span className="block truncate font-mono text-xs text-text-primary">{value}</span>
        </PropertyRow>
      ))}
      {gaps.hasGap && (
        <div className="flex items-start gap-1.5 py-1 text-[11px] text-status-warning">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{t("coverage.gapWarning")}</span>
        </div>
      )}
    </div>
  );
}
