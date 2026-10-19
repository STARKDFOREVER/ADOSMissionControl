/**
 * @module SurveyConfigSection
 * @description Survey pattern configuration UI: camera profiles, GSD, overlap, advanced settings.
 * Extracted from PatternConfigSections.tsx.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import { MIN_LINE_SPACING_M } from "@/lib/patterns/types";
import { Toggle } from "@/components/ui/toggle";
import { PropertyRow } from "@/components/ui/property-row";
import { PropertySection } from "@/components/ui/property-section";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { usePatternStore } from "@/stores/pattern-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { CAMERA_PROFILES, computeGSD, computeLineSpacing, computeTriggerDistance } from "@/lib/patterns/gsd-calculator";
import { gridAngleLineBearing, optimalLineBearing, windPenalty } from "@/lib/patterns/wind-optimized";
import { ArrowDownLeft, ArrowDownRight, ArrowUpLeft, ArrowUpRight, SquareDashed, Wind } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn, randomId } from "@/lib/utils";
import { PatternNumberRow } from "./PatternNumberRow";
import { usePlannerStore } from "@/stores/planner-store";
import {
  ENTRY_LOCATION_OPTIONS, CAMERA_OPTIONS,
  SURVEY_PRESET_OPTIONS, SURVEY_PRESETS,
} from "./pattern-editor-constants";
import { GsdSpeedControls } from "./GsdSpeedControls";
import { CoverageStats } from "./CoverageStats";
import { useCoverageCaptures } from "@/hooks/use-coverage-captures";

const ENTRY_ICONS = {
  topLeft: <ArrowUpLeft size={12} />,
  topRight: <ArrowUpRight size={12} />,
  bottomLeft: <ArrowDownLeft size={12} />,
  bottomRight: <ArrowDownRight size={12} />,
} as const;

/** Entry corners as icon segments; the full label rides on the tooltip. */
const ENTRY_OPTIONS = ENTRY_LOCATION_OPTIONS.map((o) => ({ value: o.value, label: o.label, title: o.label, icon: ENTRY_ICONS[o.value], iconOnly: true }));

export function SurveyConfig() {
  const t = useTranslations("planner");
  const te = useTranslations("planner.inspector.editor");
  const { toast } = useToast();
  const surveyConfig = usePatternStore((s) => s.surveyConfig);
  const updateSurveyConfig = usePatternStore((s) => s.updateSurveyConfig);
  const drawnPolygons = useDrawingStore((s) => s.polygons);
  const selectedPolygonIds = useDrawingStore((s) => s.selectedPolygonIds);
  const togglePolygonSelection = useDrawingStore((s) => s.togglePolygonSelection);
  const exclusionPolygonIds = usePatternStore((s) => s.exclusionPolygonIds);
  const toggleExclusionPolygonId = usePatternStore((s) => s.toggleExclusionPolygonId);
  const showCoverageOverlay = usePatternStore((s) => s.showCoverageOverlay);
  const setShowCoverageOverlay = usePatternStore((s) => s.setShowCoverageOverlay);
  const coverage = useCoverageCaptures();

  // Wind alignment is operator-entered (no live weather source yet). Both fields
  // start empty so a blank input never fabricates a 0-degree wind.
  const [windBearing, setWindBearing] = useState<number | undefined>(undefined);
  const [windSpeed, setWindSpeed] = useState<number | undefined>(undefined);

  const mapCenter = usePlannerStore((s) => s.mapCenter);
  const handleQuickRect = useCallback(() => {
    // A seeded rectangle is only meaningful where the operator is looking. The
    // previous fallback dropped it on a city centroid whenever the map had not
    // positioned yet, which put a survey area thousands of km from anyone
    // outside that city. Refuse instead, and say what to do.
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

  const extConfig = surveyConfig as { _cameraName?: string; _sidelap?: number; _frontlap?: number; _preset?: string; crosshatch?: boolean };

  const selectedCamera = useMemo(
    () => CAMERA_PROFILES.find((c) => c.name === extConfig._cameraName),
    [extConfig._cameraName]
  );

  const gsdInfo = useMemo(() => {
    if (!selectedCamera) return null;
    const alt = surveyConfig.altitude ?? 50;
    const gsd = computeGSD(alt, selectedCamera.focalLength, selectedCamera.sensorWidth, selectedCamera.imageWidth);
    return { gsd, camera: selectedCamera };
  }, [selectedCamera, surveyConfig.altitude]);

  const handleCameraChange = useCallback(
    (value: string) => {
      const camera = CAMERA_PROFILES.find((c) => c.name === value);
      if (camera) {
        const alt = surveyConfig.altitude ?? 50;
        const sidelap = 60;
        const frontlap = 70;
        const lineSpacing = computeLineSpacing(alt, camera, sidelap / 100);
        const triggerDist = computeTriggerDistance(alt, camera, frontlap / 100);
        updateSurveyConfig({
          lineSpacing: Math.round(lineSpacing * 10) / 10,
          cameraTriggerDistance: Math.round(triggerDist * 10) / 10,
          _cameraName: value,
          _sidelap: sidelap,
          _frontlap: frontlap,
        } as Partial<typeof surveyConfig>);
      } else {
        updateSurveyConfig({ _cameraName: "", _sidelap: undefined, _frontlap: undefined } as Partial<typeof surveyConfig>);
      }
    },
    [surveyConfig.altitude, updateSurveyConfig]
  );

  const handlePresetChange = useCallback(
    (value: string) => {
      const preset = SURVEY_PRESETS.find((p) => p.label === value);
      if (preset) {
        const updates: Record<string, unknown> = {
          altitude: preset.altitude,
          speed: preset.speed,
          _preset: preset.label,
          _sidelap: preset.sidelap,
          _frontlap: preset.frontlap,
        };
        if (preset.tieLines !== undefined) updates.tieLines = preset.tieLines;
        if (selectedCamera) {
          const ls = computeLineSpacing(preset.altitude, selectedCamera, preset.sidelap / 100);
          const td = computeTriggerDistance(preset.altitude, selectedCamera, preset.frontlap / 100);
          updates.lineSpacing = Math.round(ls * 10) / 10;
          updates.cameraTriggerDistance = Math.round(td * 10) / 10;
        }
        updateSurveyConfig(updates as Partial<typeof surveyConfig>);
      } else {
        updateSurveyConfig({ _preset: "" } as Partial<typeof surveyConfig>);
      }
    },
    [selectedCamera, updateSurveyConfig]
  );

  const handleSidelapChange = useCallback(
    (value: number) => {
      if (!selectedCamera) return;
      const alt = surveyConfig.altitude ?? 50;
      const ls = computeLineSpacing(alt, selectedCamera, value / 100);
      updateSurveyConfig({
        _sidelap: value,
        _preset: "",
        lineSpacing: Math.round(ls * 10) / 10,
      } as Partial<typeof surveyConfig>);
    },
    [selectedCamera, surveyConfig.altitude, updateSurveyConfig]
  );

  const handleFrontlapChange = useCallback(
    (value: number) => {
      if (!selectedCamera) return;
      const alt = surveyConfig.altitude ?? 50;
      const td = computeTriggerDistance(alt, selectedCamera, value / 100);
      updateSurveyConfig({
        _frontlap: value,
        _preset: "",
        cameraTriggerDistance: Math.round(td * 10) / 10,
      } as Partial<typeof surveyConfig>);
    },
    [selectedCamera, surveyConfig.altitude, updateSurveyConfig]
  );

  const handleAltitudeCommit = useCallback(
    (alt: number) => {
      if (!selectedCamera) {
        updateSurveyConfig({ altitude: alt });
        return;
      }
      const ls = computeLineSpacing(alt, selectedCamera, (extConfig._sidelap ?? 60) / 100);
      const td = computeTriggerDistance(alt, selectedCamera, (extConfig._frontlap ?? 70) / 100);
      updateSurveyConfig({
        altitude: alt,
        lineSpacing: Math.round(ls * 10) / 10,
        cameraTriggerDistance: Math.round(td * 10) / 10,
      });
    },
    [selectedCamera, extConfig._sidelap, extConfig._frontlap, updateSurveyConfig],
  );

  // The operator-entered wind. A bearing is required to align; speed is
  // optional and only drives the penalty hint. Blank/invalid inputs stay null so
  // nothing is fabricated.
  const hasWindBearing = windBearing !== undefined;
  const hasWindSpeed = windSpeed !== undefined && windSpeed > 0;
  // Crosswind the CURRENT grid angle forces onto the imaging legs. Optimal is 0
  // by definition, so this doubles as the benefit of clicking "Align to wind".
  // The wind helpers take compass line bearings, not grid angles.
  const crosswindPenalty = hasWindBearing && hasWindSpeed
    ? windPenalty(gridAngleLineBearing(surveyConfig.gridAngle ?? 0), windBearing, windSpeed)
    : null;

  const handleAlignToWind = useCallback(() => {
    if (windBearing === undefined) return;
    updateSurveyConfig({ gridAngle: Math.round(gridAngleLineBearing(optimalLineBearing(windBearing)) * 10) / 10 });
  }, [windBearing, updateSurveyConfig]);

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
        <Select ariaLabel={t("surveyPreset")} compact options={SURVEY_PRESET_OPTIONS} value={extConfig._preset ?? ""} onChange={handlePresetChange} />
      </PropertyRow>
      <PropertyRow label={t("cameraProfile")}>
        <Select ariaLabel={t("cameraProfile")} compact options={CAMERA_OPTIONS} value={extConfig._cameraName ?? ""} onChange={handleCameraChange} />
      </PropertyRow>
      {gsdInfo && (
        <PropertyRow label={te("gsd")} hint={te("gsdHint")}>
          <span className="block truncate font-mono text-xs text-text-primary">{(gsdInfo.gsd * 100).toFixed(2)} cm/px</span>
        </PropertyRow>
      )}

      {/* GSD-first altitude solve + motion-blur-safe speed (needs a camera) */}
      <GsdSpeedControls camera={selectedCamera}
        sidelapPct={extConfig._sidelap ?? 60} frontlapPct={extConfig._frontlap ?? 70} />

      {/* Sidelap/Frontlap (when camera selected) OR raw line spacing (fallback) */}
      {selectedCamera ? (
        <>
          <PropertyRow label={t("sidelap")}
            trailing={<span className="w-9 text-right font-mono text-xs text-text-primary">{extConfig._sidelap ?? 60}%</span>}>
            <input type="range" min={20} max={95} step={5} aria-label={t("sidelap")}
              value={extConfig._sidelap ?? 60}
              onChange={(e) => handleSidelapChange(Number(e.target.value))}
              className="w-full h-1 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary" />
          </PropertyRow>
          <PropertyRow label={t("lineSpacing")}>
            <span className="block truncate font-mono text-xs text-text-secondary">{surveyConfig.lineSpacing ?? 25} m</span>
          </PropertyRow>
          <PropertyRow label={te("frontlap")}
            trailing={<span className="w-9 text-right font-mono text-xs text-text-primary">{extConfig._frontlap ?? 70}%</span>}>
            <input type="range" min={20} max={95} step={5} aria-label={te("frontlap")}
              value={extConfig._frontlap ?? 70}
              onChange={(e) => handleFrontlapChange(Number(e.target.value))}
              className="w-full h-1 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary" />
          </PropertyRow>
          <PropertyRow label={t("cameraTriggerDist")}>
            <span className="block truncate font-mono text-xs text-text-secondary">{surveyConfig.cameraTriggerDistance ?? 0} m</span>
          </PropertyRow>
        </>
      ) : (
        <PatternNumberRow label={t("lineSpacing")} unit="m" step={0.1} min={MIN_LINE_SPACING_M}
          value={surveyConfig.lineSpacing ?? 25} onCommit={(lineSpacing) => updateSurveyConfig({ lineSpacing })} />
      )}

      <PatternNumberRow label={t("altitudeAboveHome")} unit="m" step={1} min={1}
        value={surveyConfig.altitude ?? 50} onCommit={handleAltitudeCommit} />
      <PatternNumberRow label={t("speed")} unit="m/s" step={0.5} min={0.1}
        value={surveyConfig.speed ?? 5} onCommit={(speed) => updateSurveyConfig({ speed })} />

      <PropertySection title={te("advanced")} collapsible defaultOpen={false} persistKey="pattern.survey.advanced">
        <PatternNumberRow label={t("gridAngle")} unit="deg" step={1} min={-360} max={360}
          value={surveyConfig.gridAngle ?? 0} onCommit={(gridAngle) => updateSurveyConfig({ gridAngle })} />

        {/* Wind alignment: orient survey legs along the wind so imaging passes stay
            crab-free. Wind is operator-entered (no live weather source yet). */}
        <span className="pt-2 pb-0.5 text-[11px] font-semibold text-text-tertiary">{t("survey.wind.title")}</span>
        <PatternNumberRow label={t("survey.wind.bearing")} unit="deg" step={1} min={0} max={359}
          placeholder="—" value={windBearing} onCommit={setWindBearing}
          onClear={() => setWindBearing(undefined)} />
        <PatternNumberRow label={t("survey.wind.speed")} unit="m/s" step={0.1} min={0}
          placeholder="—" value={windSpeed} onCommit={setWindSpeed}
          onClear={() => setWindSpeed(undefined)} />
        <div className="flex flex-wrap items-center gap-2 py-1">
          <button type="button" onClick={handleAlignToWind} disabled={!hasWindBearing}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-sm border border-border-default px-2 text-xs text-text-secondary transition-colors",
              hasWindBearing ? "hover:bg-bg-tertiary cursor-pointer" : "opacity-50 cursor-not-allowed",
            )}>
            <Wind size={12} /> {t("survey.wind.align")}
          </button>
          {crosswindPenalty !== null && (
            <span className="text-[11px] text-text-tertiary">
              {t("survey.wind.penaltyHint", { penalty: crosswindPenalty.toFixed(1) })}
            </span>
          )}
        </div>

        <PatternNumberRow label={t("turnAroundDistance")} unit="m" step={1} min={0}
          value={surveyConfig.turnAroundDistance ?? 10}
          onCommit={(turnAroundDistance) => updateSurveyConfig({ turnAroundDistance })} />
        <PropertyRow label={t("entryPoint")}>
          <SegmentedControl size="sm" stretch ariaLabel={t("entryPoint")} options={ENTRY_OPTIONS}
            value={surveyConfig.entryLocation ?? "topLeft"}
            onChange={(entryLocation) => updateSurveyConfig({ entryLocation })} />
        </PropertyRow>
        <PropertyRow label={t("alternateTransects")}>
          <Toggle label={t("alternateTransects")} className="[&>span]:sr-only justify-end"
            checked={surveyConfig.flyAlternateTransects ?? false}
            onChange={(v) => updateSurveyConfig({ flyAlternateTransects: v })} />
        </PropertyRow>
        <PropertyRow label={t("crosshatch")}>
          <Toggle label={t("crosshatch")} className="[&>span]:sr-only justify-end" checked={extConfig.crosshatch ?? false}
            onChange={(v) => updateSurveyConfig({ crosshatch: v, tieLines: false } as Partial<typeof surveyConfig>)} />
        </PropertyRow>
        <PropertyRow label={t("tieLines")}>
          <Toggle label={t("tieLines")} className="[&>span]:sr-only justify-end" checked={surveyConfig.tieLines ?? false}
            onChange={(v) => updateSurveyConfig({ tieLines: v })}
            disabled={extConfig.crosshatch === true} />
        </PropertyRow>
        {surveyConfig.tieLines && (
          <>
            <PatternNumberRow label={t("tieAngle")} unit="deg" step={1} min={0} max={180}
              value={surveyConfig.tieLineAngle ?? 90} onCommit={(tieLineAngle) => updateSurveyConfig({ tieLineAngle })} />
            <PatternNumberRow label={t("tieSpacing")} unit="m" step={1} min={MIN_LINE_SPACING_M}
              value={surveyConfig.tieLineSpacing ?? 25} onCommit={(tieLineSpacing) => updateSurveyConfig({ tieLineSpacing })} />
          </>
        )}
        <PatternNumberRow label={t("cameraTriggerDist")} hint={te("zeroIsOff")} unit="m" step={0.5} min={0}
          value={surveyConfig.cameraTriggerDistance ?? 0}
          onCommit={(cameraTriggerDistance) => updateSurveyConfig({ cameraTriggerDistance })} />
      </PropertySection>

      {/* Coverage statistics for the generated survey route */}
      <CoverageStats camera={selectedCamera} altitude={surveyConfig.altitude ?? 50}
        minSideOverlap={(extConfig._sidelap ?? 60) / 100} />

      {/* Draw per-image camera footprints on the map to see overlap + gaps. */}
      {selectedCamera && (
        <PropertyRow label={t("survey.coverage.showOverlay")}>
          <Toggle label={t("survey.coverage.showOverlay")} className="[&>span]:sr-only justify-end"
            checked={showCoverageOverlay} onChange={setShowCoverageOverlay} />
        </PropertyRow>
      )}
      {selectedCamera && showCoverageOverlay && coverage.total > coverage.points.length && (
        <p className="py-0.5 text-[11px] text-status-warning">
          {t("survey.coverage.truncated", { shown: coverage.points.length, total: coverage.total })}
        </p>
      )}
    </div>
  );
}
