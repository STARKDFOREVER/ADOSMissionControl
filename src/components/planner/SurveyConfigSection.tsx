/**
 * @module SurveyConfigSection
 * @description Survey pattern configuration UI: camera profiles, GSD, overlap, advanced settings.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import { MIN_LINE_SPACING_M, type SurveyConfig as SurveyConfigType } from "@/lib/patterns/types";
import { Toggle } from "@/components/ui/toggle";
import { PropertyRow } from "@/components/ui/property-row";
import { PropertySection } from "@/components/ui/property-section";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { usePatternStore } from "@/stores/pattern-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { ArrowDownLeft, ArrowDownRight, ArrowUpLeft, ArrowUpRight, SquareDashed } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { randomId } from "@/lib/utils";
import { PatternNumberRow } from "./PatternNumberRow";
import { usePlannerStore } from "@/stores/planner-store";
import { ENTRY_LOCATION_OPTIONS, SURVEY_PRESET_OPTIONS, SURVEY_PRESETS } from "./pattern-editor-constants";
import { GsdSpeedControls } from "./GsdSpeedControls";
import { CoverageStats } from "./CoverageStats";
import { useCoverageCaptures } from "@/hooks/use-coverage-captures";
import { OverlapRow, PatternCameraRows } from "./PatternCameraRows";
import { DEFAULT_FRONTLAP_PCT, DEFAULT_SIDELAP_PCT, usePatternCamera } from "./pattern-camera";
import { HoverCaptureRow, useHeightLabel } from "./PatternAltitudeSection";
import { SurveyWindRows } from "./SurveyWindRows";

const ENTRY_ICONS = {
  topLeft: <ArrowUpLeft size={12} />,
  topRight: <ArrowUpRight size={12} />,
  bottomLeft: <ArrowDownLeft size={12} />,
  bottomRight: <ArrowDownRight size={12} />,
} as const;

type SurveyUiConfig = Partial<SurveyConfigType> & { _preset?: string };

export function SurveyConfig() {
  const t = useTranslations("planner");
  const tp = useTranslations("planner.pattern");
  const te = useTranslations("planner.inspector.editor");
  const { toast } = useToast();
  const entryOptions = ENTRY_LOCATION_OPTIONS.map((o) => {
    const label = t(`inspector.pattern.entry.${o.value}`);
    return { value: o.value, label, title: label, icon: ENTRY_ICONS[o.value], iconOnly: true };
  });
  const surveyConfig = usePatternStore((s) => s.surveyConfig) as SurveyUiConfig;
  const updateSurveyConfig = usePatternStore((s) => s.updateSurveyConfig) as (u: SurveyUiConfig) => void;
  const drawnPolygons = useDrawingStore((s) => s.polygons);
  const selectedPolygonIds = useDrawingStore((s) => s.selectedPolygonIds);
  const togglePolygonSelection = useDrawingStore((s) => s.togglePolygonSelection);
  const exclusionPolygonIds = usePatternStore((s) => s.exclusionPolygonIds);
  const toggleExclusionPolygonId = usePatternStore((s) => s.toggleExclusionPolygonId);
  const showCoverageOverlay = usePatternStore((s) => s.showCoverageOverlay);
  const setShowCoverageOverlay = usePatternStore((s) => s.setShowCoverageOverlay);
  const coverage = useCoverageCaptures();
  const heightLabel = useHeightLabel(surveyConfig);
  const setHover = useCallback((hoverAndCapture: boolean) => updateSurveyConfig({ hoverAndCapture }), [updateSurveyConfig]);

  const altitude = surveyConfig.altitude ?? 50;
  const { camera, apply } = usePatternCamera(surveyConfig, "survey", altitude, updateSurveyConfig);
  const sidelap = surveyConfig._sidelap ?? DEFAULT_SIDELAP_PCT;
  const frontlap = surveyConfig._frontlap ?? DEFAULT_FRONTLAP_PCT;

  const mapCenter = usePlannerStore((s) => s.mapCenter);
  const handleQuickRect = useCallback(() => {
    // A seeded rectangle is only meaningful where the operator is looking.
    // Refuse when the map has not positioned yet, and say what to do.
    if (mapCenter[0] === 0 && mapCenter[1] === 0) {
      toast(t("noCenterHint"), "info");
      return;
    }
    const center: [number, number] = mapCenter;
    const offset = 0.001; // ~100m per side
    const vertices: [number, number][] = [
      [center[0] - offset, center[1] - offset],
      [center[0] - offset, center[1] + offset],
      [center[0] + offset, center[1] + offset],
      [center[0] + offset, center[1] - offset],
    ];
    const side = offset * 2 * 111320;
    const area = side * side * Math.cos(center[0] * Math.PI / 180);
    useDrawingStore.getState().addPolygon({ id: randomId(), vertices, area });
  }, [mapCenter, toast, t]);

  const handlePresetChange = useCallback(
    (value: string) => {
      const preset = SURVEY_PRESETS.find((p) => p.label === value);
      if (!preset) {
        updateSurveyConfig({ _preset: "" });
        return;
      }
      const update: SurveyUiConfig = {
        altitude: preset.altitude, speed: preset.speed, _preset: preset.label,
        _sidelap: preset.sidelap, _frontlap: preset.frontlap,
      };
      if (preset.tieLines !== undefined) update.tieLines = preset.tieLines;
      apply(update, preset.altitude);
    },
    [apply, updateSurveyConfig],
  );

  const polygonRow = (poly: { id: string; vertices: unknown[] }, i: number, checked: boolean, onToggle: () => void) => (
    <label key={poly.id} className="flex min-h-6 items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer hover:text-text-primary">
      <input type="checkbox" checked={checked} onChange={onToggle} className="accent-accent-primary w-3 h-3" />
      {te("polygonItem", { index: i + 1, count: poly.vertices.length })}
    </label>
  );

  return (
    <div className="flex flex-col">
      <div className="flex min-h-7 items-center gap-2 text-[11px] text-text-tertiary">
        <span className="min-w-0 flex-1 truncate">
          {surveyConfig.polygon
            ? te("polygonVertices", { count: surveyConfig.polygon.length })
            : drawnPolygons.length > 0
              ? te("polygonsSelected", { selected: selectedPolygonIds.length, total: drawnPolygons.length })
              : t("drawPolygonOnMap")}
        </span>
        {!surveyConfig.polygon && drawnPolygons.length === 0 && (
          <button type="button" onClick={handleQuickRect} title={te("quickRectHint")}
            className="flex h-6 shrink-0 items-center gap-1 rounded-sm border border-border-default px-2 text-[11px] text-text-secondary hover:bg-bg-tertiary transition-colors cursor-pointer">
            <SquareDashed size={12} /> {te("quickRect")}
          </button>
        )}
      </div>
      {!surveyConfig.polygon && drawnPolygons.length > 1 && (
        <div className="flex flex-col pb-1">
          {drawnPolygons.map((poly, i) =>
            polygonRow(poly, i, selectedPolygonIds.includes(poly.id), () => togglePolygonSelection(poly.id)))}
        </div>
      )}

      {/* Exclusion (keep-out) zones: mark drawn polygons the survey lines must skip. */}
      {drawnPolygons.length > 1 && (
        <div className="flex flex-col pb-1">
          <div className="flex min-h-7 items-center gap-2 text-[11px] text-text-tertiary">
            <span>{t("survey.exclusions.label")}</span>
            {exclusionPolygonIds.length > 0 && (
              <span className="text-text-secondary">
                {t("survey.exclusions.count", { count: exclusionPolygonIds.length })}
              </span>
            )}
          </div>
          {drawnPolygons.map((poly, i) =>
            polygonRow(poly, i, exclusionPolygonIds.includes(poly.id), () => toggleExclusionPolygonId(poly.id)))}
          <span className="text-[11px] text-text-tertiary">
            {exclusionPolygonIds.length > 0 ? t("survey.exclusions.hint") : t("survey.exclusions.empty")}
          </span>
        </div>
      )}

      <PropertyRow label={t("surveyPreset")}>
        <Select ariaLabel={t("surveyPreset")} compact options={SURVEY_PRESET_OPTIONS} value={surveyConfig._preset ?? ""} onChange={handlePresetChange} />
      </PropertyRow>
      <PatternCameraRows config={surveyConfig} camera={camera} rangeM={altitude} hideOverlaps
        speed={surveyConfig.speed ?? 5} triggerDistance={surveyConfig.cameraTriggerDistance ?? 0}
        onChange={(update) => apply(update)} />

      {/* GSD-first altitude solve + motion-blur-safe speed (needs a camera) */}
      <GsdSpeedControls camera={camera} sidelapPct={sidelap} frontlapPct={frontlap}
        orientation={surveyConfig._orientation} />

      {/* Sidelap/Frontlap (when camera selected) OR raw line spacing (fallback) */}
      {camera ? (
        <>
          <OverlapRow label={t("sidelap")} value={sidelap}
            onChange={(_sidelap) => apply({ _sidelap, _preset: "" })} />
          <PropertyRow label={t("lineSpacing")}>
            <span className="block truncate font-mono text-xs text-text-secondary">{surveyConfig.lineSpacing ?? 25} m</span>
          </PropertyRow>
          <OverlapRow label={te("frontlap")} value={frontlap}
            onChange={(_frontlap) => apply({ _frontlap, _preset: "" })} />
          <PropertyRow label={t("cameraTriggerDist")}>
            <span className="block truncate font-mono text-xs text-text-secondary">{surveyConfig.cameraTriggerDistance ?? 0} m</span>
          </PropertyRow>
        </>
      ) : (
        <PatternNumberRow label={t("lineSpacing")} unit="m" step={0.1} min={MIN_LINE_SPACING_M}
          value={surveyConfig.lineSpacing ?? 25} onCommit={(lineSpacing) => updateSurveyConfig({ lineSpacing })} />
      )}

      <PatternNumberRow label={heightLabel} unit="m" step={1} min={1}
        value={altitude} onCommit={(alt) => apply({ altitude: alt }, alt)} />
      <PatternNumberRow label={t("speed")} unit="m/s" step={0.5} min={0.1}
        value={surveyConfig.speed ?? 5} onCommit={(speed) => updateSurveyConfig({ speed })} />

      <PropertySection title={te("advanced")} collapsible defaultOpen={false} persistKey="pattern.survey.advanced" flush>
        <PatternNumberRow label={tp("gridAngleFromNorth")} unit="deg" step={1} min={0} max={179}
          value={surveyConfig.gridAngle ?? 90} onCommit={(gridAngle) => updateSurveyConfig({ gridAngle })} />

        <SurveyWindRows />

        <PatternNumberRow label={t("turnAroundDistance")} unit="m" step={1} min={0}
          value={surveyConfig.turnAroundDistance ?? 10}
          onCommit={(turnAroundDistance) => updateSurveyConfig({ turnAroundDistance })} />
        <PropertyRow label={t("entryPoint")}>
          <SegmentedControl size="sm" stretch ariaLabel={t("entryPoint")} options={entryOptions}
            value={surveyConfig.entryLocation ?? "topLeft"}
            onChange={(entryLocation) => updateSurveyConfig({ entryLocation })} />
        </PropertyRow>
        <PropertyRow label={t("alternateTransects")}>
          <Toggle label={t("alternateTransects")} className="[&>span]:sr-only justify-end"
            checked={surveyConfig.flyAlternateTransects ?? false}
            onChange={(v) => updateSurveyConfig({ flyAlternateTransects: v })} />
        </PropertyRow>
        <PropertyRow label={t("crosshatch")}>
          <Toggle label={t("crosshatch")} className="[&>span]:sr-only justify-end" checked={surveyConfig.crosshatch ?? false}
            onChange={(v) => updateSurveyConfig({ crosshatch: v, tieLines: false })} />
        </PropertyRow>
        <PropertyRow label={t("tieLines")}>
          <Toggle label={t("tieLines")} className="[&>span]:sr-only justify-end" checked={surveyConfig.tieLines ?? false}
            onChange={(v) => updateSurveyConfig({ tieLines: v })}
            disabled={surveyConfig.crosshatch === true} />
        </PropertyRow>
        {surveyConfig.tieLines && (
          <>
            <PatternNumberRow label={t("tieAngle")} unit="deg" step={1} min={0} max={180}
              value={surveyConfig.tieLineAngle ?? 90} onCommit={(tieLineAngle) => updateSurveyConfig({ tieLineAngle })} />
            <PatternNumberRow label={t("tieSpacing")} unit="m" step={1} min={MIN_LINE_SPACING_M}
              value={surveyConfig.tieLineSpacing ?? 25} onCommit={(tieLineSpacing) => updateSurveyConfig({ tieLineSpacing })} />
          </>
        )}
        <HoverCaptureRow checked={surveyConfig.hoverAndCapture ?? false}
          onChange={setHover} />
        {/* With a camera the trigger distance comes from the front overlap (read-only above). */}
        {!camera && (
          <PatternNumberRow label={t("cameraTriggerDist")} hint={te("zeroIsOff")} unit="m" step={0.5} min={0}
            value={surveyConfig.cameraTriggerDistance ?? 0}
            onCommit={(cameraTriggerDistance) => updateSurveyConfig({ cameraTriggerDistance })} />
        )}
      </PropertySection>

      {/* Coverage statistics for the generated survey route */}
      <CoverageStats camera={camera} altitude={altitude} orientation={surveyConfig._orientation}
        lineSpacingM={surveyConfig.lineSpacing} minSideOverlap={sidelap / 100} />

      {/* Draw per-image camera footprints on the map to see overlap + gaps. */}
      {camera && (
        <PropertyRow label={t("survey.coverage.showOverlay")}>
          <Toggle label={t("survey.coverage.showOverlay")} className="[&>span]:sr-only justify-end"
            checked={showCoverageOverlay} onChange={setShowCoverageOverlay} />
        </PropertyRow>
      )}
      {camera && showCoverageOverlay && coverage.total > coverage.points.length && (
        <p className="py-0.5 text-[11px] text-status-warning">
          {t("survey.coverage.truncated", { shown: coverage.points.length, total: coverage.total })}
        </p>
      )}
    </div>
  );
}
