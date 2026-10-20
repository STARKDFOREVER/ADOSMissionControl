/**
 * @module SurveyWindRows
 * @description Wind alignment for the survey: orient the lines along the
 * wind so the imaging passes stay crab-free. The wind defaults to the Site
 * tab's forecast; an entered value overrides it and lives in the pattern
 * store so it survives the editor closing.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { Wind } from "lucide-react";
import { usePatternStore } from "@/stores/pattern-store";
import { useSiteWeatherStore } from "@/stores/site-weather-store";
import { optimalLineBearing, windPenalty } from "@/lib/patterns/wind-optimized";
import { cn } from "@/lib/utils";
import { PatternNumberRow } from "./PatternNumberRow";

export function SurveyWindRows() {
  const t = useTranslations("planner");
  const tp = useTranslations("planner.pattern");
  const gridAngle = usePatternStore((s) => s.surveyConfig.gridAngle ?? 90);
  const updateSurveyConfig = usePatternStore((s) => s.updateSurveyConfig);
  const wind = usePatternStore((s) => s.surveyWind);
  const setSurveyWind = usePatternStore((s) => s.setSurveyWind);
  const forecast = useSiteWeatherStore((s) => s.report);

  const bearing = wind.bearingDeg ?? forecast?.windDirectionDeg ?? null;
  const speed = wind.speedMps ?? forecast?.windSpeedMps ?? null;
  const fromForecast = (wind.bearingDeg === null && forecast?.windDirectionDeg != null)
    || (wind.speedMps === null && forecast?.windSpeedMps != null);
  // Crosswind the current grid angle (a line bearing) forces onto the legs.
  const crosswindPenalty = bearing !== null && speed !== null && speed > 0
    ? windPenalty(gridAngle, bearing, speed)
    : null;

  const handleAlignToWind = useCallback(() => {
    if (bearing === null) return;
    updateSurveyConfig({ gridAngle: Math.round(optimalLineBearing(bearing) * 10) / 10 });
  }, [bearing, updateSurveyConfig]);

  return (
    <>
      <span className="pt-2 pb-0.5 text-[11px] font-semibold text-text-tertiary">{t("survey.wind.title")}</span>
      <PatternNumberRow label={t("survey.wind.bearing")} unit="deg" step={1} min={0} max={359}
        placeholder="—" value={bearing} onCommit={(bearingDeg) => setSurveyWind({ bearingDeg })}
        onClear={() => setSurveyWind({ bearingDeg: null })} />
      <PatternNumberRow label={t("survey.wind.speed")} unit="m/s" step={0.1} min={0}
        placeholder="—" value={speed} onCommit={(speedMps) => setSurveyWind({ speedMps })}
        onClear={() => setSurveyWind({ speedMps: null })} />
      {fromForecast && <p className="text-[11px] text-text-tertiary">{tp("windFromForecast")}</p>}
      <div className="flex flex-wrap items-center gap-2 py-1">
        <button type="button" onClick={handleAlignToWind} disabled={bearing === null}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-sm border border-border-default px-2 text-xs text-text-secondary transition-colors",
            bearing !== null ? "hover:bg-bg-tertiary cursor-pointer" : "opacity-50 cursor-not-allowed",
          )}>
          <Wind size={12} /> {t("survey.wind.align")}
        </button>
        {crosswindPenalty !== null && (
          <span className="text-[11px] text-text-tertiary">
            {t("survey.wind.penaltyHint", { penalty: crosswindPenalty.toFixed(1) })}
          </span>
        )}
      </div>
    </>
  );
}
