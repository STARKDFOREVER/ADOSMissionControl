/**
 * @module PatternEditor
 * @description Flight pattern editor (survey, orbit, corridor, perimeter, SAR,
 * structure scan, landings). Shows the active pattern's settings, a "Draw
 * area" shortcut for area patterns, readiness, generation stats, and the
 * Generate / Apply / Clear actions. Survey mode integrates the GSD calculator.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback, useEffect, useId, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import { PropertyRow } from "@/components/ui/property-row";
import { usePatternStore } from "@/stores/pattern-store";
import { selectPatternType } from "@/stores/pattern-selection";
import { useDrawingStore } from "@/stores/drawing-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useSettingsStore } from "@/stores/settings-store";
import { formatDistance, formatArea } from "@/lib/units/format";
import { Play, Trash2, AlertTriangle, Check, X, Puzzle, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { FleetPluginSlot } from "@/components/plugins/FleetPluginSlot";
import { useFleetPluginContributions } from "@/hooks/use-fleet-plugin-contributions";
import { PATTERN_TYPE_OPTIONS, VALID_PATTERN_TYPES } from "./pattern-editor-constants";
import {
  SurveyConfig, OrbitConfig, CorridorConfig,
  SarExpandingSquareConfig, SarSectorSearchConfig, SarParallelTrackConfig,
  StructureScanConfig,
} from "./PatternConfigSections";
import { FixedWingLandingConfig } from "./FixedWingLandingConfigSection";
import { VtolLandingConfig } from "./VtolLandingConfigSection";
import { PerimeterConfig } from "./PerimeterConfigSection";
import type { SurveyConfig as SurveyConfigType } from "@/lib/patterns/types";
import type { PatternType } from "@/stores/pattern-store";
import { CAMERA_PROFILES, computeLineSpacing, computeTriggerDistance } from "@/lib/patterns/gsd-calculator";

/** Survey config plus the planner's UI-only overlap / camera helper fields. */
type SurveyDeliverableConfig = Partial<SurveyConfigType> & {
  _sidelap?: number;
  _frontlap?: number;
  _preset?: string;
  _cameraName?: string;
};

interface PatternEditorProps {
  onApply?: () => void;
}

// Survey overlap presets by target deliverable; each sets side/front overlap.
const SURVEY_DELIVERABLE_PRESETS = [
  { key: "orthomosaic", labelKey: "presetOrthomosaic", sideOverlap: 70, frontOverlap: 70 },
  { key: "model3d", labelKey: "presetModel3d", sideOverlap: 80, frontOverlap: 80 },
  { key: "fastLowDetail", labelKey: "presetFastLowDetail", sideOverlap: 60, frontOverlap: 60 },
] as const;

/**
 * The shape "Draw area" arms for each area pattern. Corridor draws its path
 * with its own button; point-origin patterns (SAR, landings) use the datum tool.
 */
const DRAW_AREA_SHAPE: Partial<Record<NonNullable<PatternType>, "polygon" | "circle">> = {
  survey: "polygon",
  perimeter: "polygon",
  structureScan: "polygon",
  orbit: "circle",
};

const secondaryButton =
  "flex h-7 items-center justify-center gap-1.5 rounded-sm border border-border-default px-2 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer focus-ring";

export function PatternEditor({ onApply }: PatternEditorProps) {
  const t = useTranslations("planner");
  const tIns = useTranslations("planner.inspector.pattern");
  const units = useSettingsStore((s) => s.units);
  const activeType = usePatternStore((s) => s.activePatternType);
  const surveyConfig = usePatternStore((s) => s.surveyConfig);
  const orbitConfig = usePatternStore((s) => s.orbitConfig);
  const structureScanConfig = usePatternStore((s) => s.structureScanConfig);
  const corridorConfig = usePatternStore((s) => s.corridorConfig);
  const perimeterConfig = usePatternStore((s) => s.perimeterConfig);
  const sarExpandingSquareConfig = usePatternStore((s) => s.sarExpandingSquareConfig);
  const sarSectorSearchConfig = usePatternStore((s) => s.sarSectorSearchConfig);
  const sarParallelTrackConfig = usePatternStore((s) => s.sarParallelTrackConfig);
  const fixedWingLandingConfig = usePatternStore((s) => s.fixedWingLandingConfig);
  const vtolLandingConfig = usePatternStore((s) => s.vtolLandingConfig);
  const generate = usePatternStore((s) => s.generate);
  const clear = usePatternStore((s) => s.clear);
  const patternResult = usePatternStore((s) => s.patternResult);
  const isGenerating = usePatternStore((s) => s.isGenerating);
  const error = usePatternStore((s) => s.error);

  const polygons = useDrawingStore((s) => s.polygons);
  const circles = useDrawingStore((s) => s.circles);

  const handleTypeChange = useCallback(
    (value: string) => {
      if (VALID_PATTERN_TYPES.has(value)) selectPatternType(value as typeof activeType);
    },
    []
  );

  // Compute whether geometry is available for the active pattern type
  const hasGeometry = useMemo(() => {
    if (!activeType) return false;
    switch (activeType) {
      case "survey": return !!(surveyConfig.polygon || polygons.length > 0);
      case "orbit": return !!(orbitConfig.center || circles.length > 0);
      case "structureScan": return !!(structureScanConfig.structurePolygon || polygons.length > 0);
      case "perimeter": return !!(perimeterConfig.polygon || polygons.length > 0);
      case "corridor": return !!corridorConfig.pathPoints;
      case "expandingSquare": return !!sarExpandingSquareConfig?.center;
      case "sectorSearch": return !!sarSectorSearchConfig?.center;
      case "parallelTrack": return !!sarParallelTrackConfig?.startPoint;
      case "fixedWingLanding": return !!fixedWingLandingConfig?.landingPoint;
      case "vtolLanding": return !!vtolLandingConfig?.landingPoint;
      default: return false;
    }
  }, [activeType, surveyConfig.polygon, polygons.length, orbitConfig.center, circles.length,
    structureScanConfig.structurePolygon, perimeterConfig.polygon, corridorConfig.pathPoints,
    sarExpandingSquareConfig?.center, sarSectorSearchConfig?.center, sarParallelTrackConfig?.startPoint,
    fixedWingLandingConfig?.landingPoint, vtolLandingConfig?.landingPoint]);

  // Stable config fingerprint — only re-generate when the ACTIVE config's values change
  const configKey = useMemo(() => {
    if (!activeType) return "";
    const cfg = activeType === "survey" ? surveyConfig
      : activeType === "orbit" ? orbitConfig
      : activeType === "corridor" ? corridorConfig
      : activeType === "perimeter" ? perimeterConfig
      : activeType === "expandingSquare" ? sarExpandingSquareConfig
      : activeType === "sectorSearch" ? sarSectorSearchConfig
      : activeType === "parallelTrack" ? sarParallelTrackConfig
      : activeType === "fixedWingLanding" ? fixedWingLandingConfig
      : activeType === "vtolLanding" ? vtolLandingConfig
      : structureScanConfig;
    return JSON.stringify(cfg);
  }, [activeType, surveyConfig, orbitConfig, corridorConfig, perimeterConfig, structureScanConfig,
    sarExpandingSquareConfig, sarSectorSearchConfig, sarParallelTrackConfig,
    fixedWingLandingConfig, vtolLandingConfig]);

  // Auto-generate on config/geometry change (300ms debounce)
  useEffect(() => {
    if (!activeType || !hasGeometry) return;
    const timer = setTimeout(() => generate(), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType, configKey, polygons.length, circles.length, generate]);

  const patternTypeOptions = PATTERN_TYPE_OPTIONS.map((o) => ({
    ...o,
    label: t(`rail.patternTypes.${o.value}` as Parameters<typeof t>[0]),
  }));

  const typeRow = (
    <PropertyRow label={tIns("type")}>
      <Select options={patternTypeOptions} value={activeType ?? ""} onChange={handleTypeChange}
        ariaLabel={tIns("type")} compact placeholder={activeType ? undefined : tIns("selectType")} />
    </PropertyRow>
  );

  if (!activeType) {
    return (
      <div className="flex flex-col">
        {typeRow}
        <p className="mt-1 text-[11px] text-text-tertiary">{tIns("hint")}</p>
        <PluginMissionTemplates />
      </div>
    );
  }

  const drawShape = DRAW_AREA_SHAPE[activeType];
  const missingGeometryHint =
    activeType === "survey" || activeType === "structureScan" || activeType === "perimeter" ? t("drawPolygonFirst") :
    activeType === "orbit" ? t("drawCircleFirst") :
    activeType === "corridor" ? t("setPathPoints") :
    activeType === "parallelTrack" ? t("setStartPoint") :
    activeType === "fixedWingLanding" || activeType === "vtolLanding" ? t("setLandingPoint") : t("setDatumPoint");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col">
        {typeRow}
        {drawShape && (
          <button type="button" className={cn(secondaryButton, "mt-1")}
            onClick={() => usePlannerStore.getState().setMode({ kind: "draw", shape: drawShape, drawingFor: "pattern" })}>
            <PenLine size={12} />
            {tIns("drawArea")}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {activeType === "survey" && <SurveyConfig />}
        {activeType === "survey" && <SurveyDeliverablePresets />}
        {activeType === "orbit" && <OrbitConfig />}
        {activeType === "corridor" && <CorridorConfig />}
        {activeType === "expandingSquare" && <SarExpandingSquareConfig />}
        {activeType === "sectorSearch" && <SarSectorSearchConfig />}
        {activeType === "parallelTrack" && <SarParallelTrackConfig />}
        {activeType === "structureScan" && <StructureScanConfig />}
        {activeType === "perimeter" && <PerimeterConfig />}
        {activeType === "fixedWingLanding" && <FixedWingLandingConfig />}
        {activeType === "vtolLanding" && <VtolLandingConfig />}
      </div>

      {/* Readiness indicator */}
      <div className="flex items-center gap-1.5" role="status">
        <span className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          isGenerating ? "bg-text-secondary animate-pulse" : hasGeometry ? "bg-status-success" : "bg-status-warning",
        )} />
        <span className={cn(
          "text-[11px]",
          isGenerating ? "text-text-secondary" : hasGeometry ? "text-status-success" : "text-status-warning",
        )}>
          {isGenerating ? t("generating") : hasGeometry ? t("ready") : missingGeometryHint}
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-status-error" />
          <span className="text-[11px] text-status-error">{error}</span>
        </div>
      )}

      {/* Generate / Apply / Clear */}
      <div className="flex gap-1.5">
        <button type="button" onClick={generate} disabled={isGenerating}
          className={cn(secondaryButton, "flex-1", isGenerating && "opacity-50 cursor-wait")}>
          <Play size={12} />{isGenerating ? t("generating") : tIns("generate")}
        </button>
        {(polygons.length > 0 || circles.length > 0) && (
          <button type="button" onClick={() => useDrawingStore.getState().clearAll()}
            className={secondaryButton} title={tIns("clearShapesTitle")}>
            <X size={12} /> {tIns("clearShapes")}
          </button>
        )}
        <button type="button" onClick={clear} className={secondaryButton}
          title={tIns("clearPattern")} aria-label={tIns("clearPattern")}>
          <Trash2 size={12} />
        </button>
      </div>

      {patternResult && onApply && (
        <button type="button" onClick={onApply}
          className={cn(secondaryButton, "h-8 w-full font-semibold text-text-primary")}>
          <Check size={12} />{tIns("apply", { count: patternResult.waypoints.length })}
        </button>
      )}

      {patternResult && (
        <div className="flex flex-col border-t border-border-default pt-2">
          <span className="mb-1 font-body text-[11px] font-semibold text-text-tertiary">{tIns("stats")}</span>
          <StatRow label={tIns("distance")} value={formatDistance(patternResult.stats.totalDistance, units)} />
          <StatRow label={tIns("time")}
            value={`${Math.floor(patternResult.stats.estimatedTime / 60)}m ${Math.round(patternResult.stats.estimatedTime % 60)}s`} />
          <StatRow label={tIns("waypoints")} value={String(patternResult.waypoints.length)} />
          {patternResult.stats.photoCount > 0 && (
            <StatRow label={tIns("photos")} value={String(patternResult.stats.photoCount)} />
          )}
          {patternResult.stats.coveredArea > 0 && (
            <StatRow label={tIns("area")} value={formatArea(patternResult.stats.coveredArea, units)} />
          )}
          {patternResult.stats.transectCount > 0 && (
            <StatRow label={tIns("transects")} value={String(patternResult.stats.transectCount)} />
          )}
        </div>
      )}

      <PluginMissionTemplates />
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <PropertyRow label={label}>
      <span className="font-mono text-xs text-text-primary">{value}</span>
    </PropertyRow>
  );
}

// A row of one-click survey overlap presets, shown only while survey is active.
export function SurveyDeliverablePresets() {
  const t = useTranslations("planner");
  const apply = useCallback((sideOverlap: number, frontOverlap: number) => {
    const store = usePatternStore.getState();
    const cfg = store.surveyConfig as SurveyDeliverableConfig;
    const camera = cfg._cameraName ? CAMERA_PROFILES.find((c) => c.name === cfg._cameraName) : undefined;
    const update: SurveyDeliverableConfig = { _sidelap: sideOverlap, _frontlap: frontOverlap, _preset: "" };
    // A preset only changes the deliverable if it recomputes the grid geometry
    // the generator actually reads. Side overlap drives line spacing, front
    // overlap drives the camera trigger distance — exactly as the manual overlap
    // controls do. With no camera selected we set only the overlap fields (no
    // fabricated spacing).
    if (camera) {
      const alt = cfg.altitude ?? 50;
      update.lineSpacing = Math.round(computeLineSpacing(alt, camera, sideOverlap / 100) * 10) / 10;
      update.cameraTriggerDistance = Math.round(computeTriggerDistance(alt, camera, frontOverlap / 100) * 10) / 10;
    }
    store.updateSurveyConfig(update as Partial<SurveyConfigType>);
  }, []);
  const labelId = useId();
  // Label above, buttons across the full width: three presets don't fit beside
  // a 96 px label. A long name wraps inside its button rather than truncating.
  return (
    <div className="flex flex-col gap-1 py-1" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="text-xs leading-tight text-text-secondary">
        {t("deliverablePresets")}
      </span>
      <div className="flex gap-1">
        {SURVEY_DELIVERABLE_PRESETS.map((p) => (
          <button key={p.key} type="button" onClick={() => apply(p.sideOverlap, p.frontOverlap)}
            className="min-h-7 min-w-0 flex-1 rounded-sm border border-border-default px-1 py-0.5 text-[11px] leading-tight text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer focus-ring">
            {t(p.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The fleet `mission.template` slot in the planner gallery. A GCS-level plugin
 * that contributes a `mission.template` gets its sandboxed iframe mounted here
 * under an "Extensions" heading. Inert until a plugin contributes.
 */
function PluginMissionTemplates() {
  // Gate before useTranslations so a planner test with no plugin (and no intl
  // provider) never invokes the intl hook.
  const contributions = useFleetPluginContributions("mission.template");
  if (contributions.length === 0) return null;
  return <PluginMissionTemplatesBody />;
}

function PluginMissionTemplatesBody() {
  const t = useTranslations("plugins");
  return (
    <div className="flex flex-col gap-1.5 border-t border-border-default pt-2">
      <div className="flex items-center gap-1.5">
        <Puzzle size={12} className="text-text-tertiary" />
        <span className="font-body text-[11px] font-semibold text-text-tertiary">
          {t("missionTemplatesHeading")}
        </span>
      </div>
      <FleetPluginSlot
        name="mission.template"
        className="space-y-2"
        iframeClassName="w-full h-40 border border-border-default rounded bg-bg-secondary"
      />
    </div>
  );
}
