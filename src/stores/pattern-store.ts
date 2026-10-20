/**
 * @module pattern-store
 * @description Zustand store for flight pattern generation state.
 * Holds config for each pattern type, the generated result, and actions
 * to update config, trigger generation, and clear. Pattern config is never
 * persisted.
 *
 * A pattern in the follow-terrain altitude mode generates in two steps: the
 * generator lays the path, then the ground is sampled along every leg. While
 * sampling there is no result to apply, and when the ground is unknown the
 * result stays empty and `terrainStatus` says so.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type {
  SurveyConfig,
  OrbitConfig,
  CorridorConfig,
  FacadeConfig,
  PatternResult,
  PerimeterConfig,
  FixedWingLandingConfig,
  VtolLandingConfig,
} from "@/lib/patterns/types";
import type { ExpandingSquareConfig, SectorSearchConfig, ParallelTrackConfig } from "@/lib/patterns/sar-generators";
import type { StructureScanConfig } from "@/lib/patterns/structure-scan-generator";
import { followTerrain, withTerrainFrame } from "@/lib/patterns/follow-terrain";
import { offsetPoint } from "@/lib/drawing/geo-utils";
import { formatErrorMessage } from "@/lib/utils";
import { useDrawingStore } from "./drawing-store";
import { activeAltitudeSettings, generatePattern } from "./pattern-generation";
import {
  defaultSurvey, defaultOrbit, defaultCorridor, defaultFacade, defaultExpandingSquare,
  defaultSectorSearch, defaultParallelTrack, defaultStructureScan, defaultPerimeter,
  defaultFixedWingLanding, defaultVtolLanding,
} from "./pattern-defaults";

export type PatternType = "survey" | "orbit" | "corridor" | "facade" | "expandingSquare" | "sectorSearch" | "parallelTrack" | "structureScan" | "perimeter" | "fixedWingLanding" | "vtolLanding" | null;

/**
 * A faint outline captured from the last-applied pattern's input geometry.
 * Kept in memory only (never persisted) so the map can keep showing where a
 * pattern was placed after its waypoints are applied and the active pattern
 * is cleared. Rendered inert (dashed, low opacity) by PatternOverlay.
 */
export type AppliedBoundary =
  | { kind: "polygon"; positions: [number, number][] }
  | { kind: "polyline"; positions: [number, number][] }
  | { kind: "circle"; center: [number, number]; radius: number }
  | { kind: "point"; center: [number, number] };

/** Ground sampling for a follow-terrain pattern: idle, in flight, or failed (ground unknown). */
export type TerrainStatus = "idle" | "sampling" | "failed";

/** Operator-entered survey wind; null fields fall back to the site forecast. */
export interface SurveyWind {
  bearingDeg: number | null;
  speedMps: number | null;
}

interface PatternStoreState {
  activePatternType: PatternType;
  surveyConfig: Partial<SurveyConfig>;
  /** IDs of drawn polygons marked as survey exclusion (keep-out) zones. */
  exclusionPolygonIds: string[];
  /** Session flag: draw per-image camera footprints on the map (coverage preview). */
  showCoverageOverlay: boolean;
  /** Wind the survey aligns to, as entered; unset fields use the forecast. */
  surveyWind: SurveyWind;
  orbitConfig: Partial<OrbitConfig>;
  corridorConfig: Partial<CorridorConfig>;
  facadeConfig: Partial<FacadeConfig>;
  sarExpandingSquareConfig: Partial<ExpandingSquareConfig>;
  sarSectorSearchConfig: Partial<SectorSearchConfig>;
  sarParallelTrackConfig: Partial<ParallelTrackConfig>;
  structureScanConfig: Partial<StructureScanConfig>;
  perimeterConfig: Partial<PerimeterConfig>;
  fixedWingLandingConfig: Partial<FixedWingLandingConfig>;
  vtolLandingConfig: Partial<VtolLandingConfig>;
  patternResult: PatternResult | null;
  /** Faint outline of the last-applied pattern's input area (in-memory only). */
  appliedBoundary: AppliedBoundary | null;
  isGenerating: boolean;
  terrainStatus: TerrainStatus;
  error: string | null;

  setPatternType: (type: PatternType) => void;
  setAppliedBoundary: (boundary: AppliedBoundary | null) => void;
  clearAppliedBoundary: () => void;
  updateSurveyConfig: (update: Partial<SurveyConfig>) => void;
  setExclusionPolygonIds: (ids: string[]) => void;
  toggleExclusionPolygonId: (id: string) => void;
  setShowCoverageOverlay: (show: boolean) => void;
  setSurveyWind: (update: Partial<SurveyWind>) => void;
  updateOrbitConfig: (update: Partial<OrbitConfig>) => void;
  updateCorridorConfig: (update: Partial<CorridorConfig>) => void;
  updateFacadeConfig: (update: Partial<FacadeConfig>) => void;
  updateSarExpandingSquareConfig: (update: Partial<ExpandingSquareConfig>) => void;
  updateSarSectorSearchConfig: (update: Partial<SectorSearchConfig>) => void;
  updateSarParallelTrackConfig: (update: Partial<ParallelTrackConfig>) => void;
  updateStructureScanConfig: (update: Partial<StructureScanConfig>) => void;
  updatePerimeterConfig: (update: Partial<PerimeterConfig>) => void;
  updateFixedWingLandingConfig: (update: Partial<FixedWingLandingConfig>) => void;
  updateVtolLandingConfig: (update: Partial<VtolLandingConfig>) => void;
  generate: () => void;
  clear: () => void;
}

const NO_WIND: SurveyWind = { bearingDeg: null, speedMps: null };

const MISSING_GEOMETRY_MESSAGES: Record<string, string> = {
  survey: "Draw a polygon on the map first",
  orbit: "Draw a circle or click to set orbit center",
  corridor: "Draw the corridor path on the map first",
  facade: "Draw the facade base line on the map first",
  expandingSquare: "Click map to set datum point",
  sectorSearch: "Click map to set datum point",
  parallelTrack: "Click map to set start point",
  structureScan: "Draw structure boundary polygon on map",
  perimeter: "Draw a polygon on the map first",
  fixedWingLanding: "Set the landing point first",
  vtolLanding: "Set the landing point first",
};

/** Ground sampling step along each leg of a follow-terrain pattern, metres. */
const TERRAIN_SAMPLE_SPACING_M = 30;

/** The in-flight terrain sampling, cancelled when a newer generation starts. */
let terrainRun: AbortController | null = null;

function cancelTerrainRun(): void {
  terrainRun?.abort();
  terrainRun = null;
}

/** Approximate outward reach of an expanding-square spiral, for a coverage ring. */
export function expandingSquareReach(cfg: Partial<ExpandingSquareConfig>): number {
  const spacing = cfg.legSpacing ?? 50;
  const legs = cfg.maxLegs ?? 20;
  return spacing * Math.max(1, Math.ceil(legs / 2));
}

/** Rectangle covering a parallel-track search area, or null when degenerate. */
export function parallelTrackRect(cfg: Partial<ParallelTrackConfig>): [number, number][] | null {
  if (!cfg.startPoint) return null;
  const [lat, lon] = cfg.startPoint;
  const bearing = cfg.bearing ?? 0;
  const length = cfg.trackLength ?? 0;
  const width = Math.max((cfg.trackCount ?? 1) - 1, 0) * (cfg.trackSpacing ?? 0);
  if (length <= 0 || width <= 0) return null;
  const perp = (bearing + 90) % 360;
  const c2 = offsetPoint(lat, lon, bearing, length);
  const c3 = offsetPoint(c2[0], c2[1], perp, width);
  const c4 = offsetPoint(lat, lon, perp, width);
  return [[lat, lon], c2, c3, c4];
}

/** Read the current active pattern's input geometry as a boundary shape. */
function deriveInputGeometry(state: PatternStoreState): AppliedBoundary | null {
  const draw = useDrawingStore.getState();
  const polys = draw.polygons ?? [];
  const circles = draw.circles ?? [];
  const lastPoly = polys[polys.length - 1];
  const lastCircle = circles[circles.length - 1];
  const drawnPolygon = lastPoly && lastPoly.vertices.length >= 3 ? lastPoly.vertices : null;
  const configPolygon = (poly: [number, number][] | undefined): AppliedBoundary | null => {
    const ring = poly && poly.length >= 3 ? poly : drawnPolygon;
    return ring ? { kind: "polygon", positions: ring } : null;
  };
  const configLine = (pts: [number, number][] | undefined): AppliedBoundary | null =>
    pts && pts.length >= 2 ? { kind: "polyline", positions: pts } : null;

  switch (state.activePatternType) {
    case "survey": return configPolygon(state.surveyConfig.polygon);
    case "structureScan": return configPolygon(state.structureScanConfig.structurePolygon);
    case "perimeter": return configPolygon(state.perimeterConfig.polygon);
    case "orbit": {
      const center = state.orbitConfig.center ?? lastCircle?.center ?? null;
      if (!center) return null;
      const radius = state.orbitConfig.radius ?? lastCircle?.radius ?? 50;
      return { kind: "circle", center, radius };
    }
    case "corridor": return configLine(state.corridorConfig.pathPoints);
    case "facade": return configLine(state.facadeConfig.pathPoints);
    case "expandingSquare": {
      const c = state.sarExpandingSquareConfig.center;
      return c ? { kind: "circle", center: c, radius: expandingSquareReach(state.sarExpandingSquareConfig) } : null;
    }
    case "sectorSearch": {
      const c = state.sarSectorSearchConfig.center;
      return c ? { kind: "circle", center: c, radius: state.sarSectorSearchConfig.radius ?? 200 } : null;
    }
    case "parallelTrack": {
      const rect = parallelTrackRect(state.sarParallelTrackConfig);
      if (rect) return { kind: "polygon", positions: rect };
      const sp = state.sarParallelTrackConfig.startPoint;
      return sp ? { kind: "point", center: sp } : null;
    }
    case "fixedWingLanding": {
      const p = state.fixedWingLandingConfig.landingPoint;
      return p ? { kind: "point", center: p } : null;
    }
    case "vtolLanding": {
      const p = state.vtolLandingConfig.landingPoint;
      return p ? { kind: "point", center: p } : null;
    }
    default:
      return null;
  }
}

/** Every pattern config back at its defaults, with no active pattern. */
function freshConfigs() {
  return {
    activePatternType: null,
    exclusionPolygonIds: [],
    showCoverageOverlay: false,
    surveyWind: { ...NO_WIND },
    surveyConfig: { ...defaultSurvey },
    orbitConfig: { ...defaultOrbit },
    corridorConfig: { ...defaultCorridor },
    facadeConfig: { ...defaultFacade },
    sarExpandingSquareConfig: { ...defaultExpandingSquare },
    sarSectorSearchConfig: { ...defaultSectorSearch },
    sarParallelTrackConfig: { ...defaultParallelTrack },
    structureScanConfig: { ...defaultStructureScan },
    perimeterConfig: { ...defaultPerimeter },
    fixedWingLandingConfig: { ...defaultFixedWingLanding },
    vtolLandingConfig: { ...defaultVtolLanding },
    patternResult: null,
    isGenerating: false,
    terrainStatus: "idle",
    error: null,
  } satisfies Partial<PatternStoreState>;
}

export const usePatternStore = create<PatternStoreState>()((set, get) => ({
  ...freshConfigs(),
  appliedBoundary: null,

  setAppliedBoundary: (boundary) => set({ appliedBoundary: boundary }),
  clearAppliedBoundary: () => set({ appliedBoundary: null }),

  setPatternType: (type) => {
    // Clear any previously drawn shapes so the new pattern can't silently
    // regenerate over the last polygon/circle via the generator's fallback.
    useDrawingStore.getState().clearAll();
    cancelTerrainRun();
    set({
      activePatternType: type,
      patternResult: null,
      error: null,
      isGenerating: false,
      terrainStatus: "idle",
      exclusionPolygonIds: [],
      showCoverageOverlay: false,
      surveyConfig: { ...get().surveyConfig, polygon: undefined },
      structureScanConfig: { ...get().structureScanConfig, structurePolygon: undefined },
      perimeterConfig: { ...get().perimeterConfig, polygon: undefined },
    });
  },

  updateSurveyConfig: (update) =>
    set((s) => ({ surveyConfig: { ...s.surveyConfig, ...update } })),

  setExclusionPolygonIds: (ids) => set({ exclusionPolygonIds: ids }),

  setShowCoverageOverlay: (showCoverageOverlay) => set({ showCoverageOverlay }),

  setSurveyWind: (update) => set((s) => ({ surveyWind: { ...s.surveyWind, ...update } })),

  toggleExclusionPolygonId: (id) =>
    set((s) => ({
      exclusionPolygonIds: s.exclusionPolygonIds.includes(id)
        ? s.exclusionPolygonIds.filter((x) => x !== id)
        : [...s.exclusionPolygonIds, id],
    })),

  updateOrbitConfig: (update) =>
    set((s) => ({ orbitConfig: { ...s.orbitConfig, ...update } })),

  updateCorridorConfig: (update) =>
    set((s) => ({ corridorConfig: { ...s.corridorConfig, ...update } })),

  updateFacadeConfig: (update) =>
    set((s) => ({ facadeConfig: { ...s.facadeConfig, ...update } })),

  updateSarExpandingSquareConfig: (update) =>
    set((s) => ({ sarExpandingSquareConfig: { ...s.sarExpandingSquareConfig, ...update } })),

  updateSarSectorSearchConfig: (update) =>
    set((s) => ({ sarSectorSearchConfig: { ...s.sarSectorSearchConfig, ...update } })),

  updateSarParallelTrackConfig: (update) =>
    set((s) => ({ sarParallelTrackConfig: { ...s.sarParallelTrackConfig, ...update } })),

  updateStructureScanConfig: (update) =>
    set((s) => ({ structureScanConfig: { ...s.structureScanConfig, ...update } })),

  updatePerimeterConfig: (update) =>
    set((s) => ({ perimeterConfig: { ...s.perimeterConfig, ...update } })),

  updateFixedWingLandingConfig: (update) =>
    set((s) => ({ fixedWingLandingConfig: { ...s.fixedWingLandingConfig, ...update } })),

  updateVtolLandingConfig: (update) =>
    set((s) => ({ vtolLandingConfig: { ...s.vtolLandingConfig, ...update } })),

  generate: () => {
    const state = get();
    if (!state.activePatternType) return;
    cancelTerrainRun();
    set({ isGenerating: true, error: null, terrainStatus: "idle" });

    let result: PatternResult | null;
    try {
      result = generatePattern(state);
    } catch (err) {
      set({ error: formatErrorMessage(err), patternResult: null, isGenerating: false });
      return;
    }
    if (result === null) {
      set({ patternResult: null, isGenerating: false, error: MISSING_GEOMETRY_MESSAGES[state.activePatternType] ?? "Missing input geometry" });
      return;
    }

    const altitude = activeAltitudeSettings(state);
    const mode = altitude?.settings.altitudeMode ?? "relative";
    if (mode === "terrain") {
      set({ patternResult: withTerrainFrame(result), isGenerating: false });
      return;
    }
    if (mode !== "followTerrain" || !altitude) {
      set({ patternResult: result, isGenerating: false });
      return;
    }

    // Follow terrain: nothing to apply until the ground along every leg is known.
    const run = new AbortController();
    terrainRun = run;
    set({ patternResult: null, terrainStatus: "sampling" });
    const spacing = altitude.triggerDistance > 0
      ? Math.min(TERRAIN_SAMPLE_SPACING_M, altitude.triggerDistance)
      : TERRAIN_SAMPLE_SPACING_M;
    followTerrain(result, altitude.settings.followTerrain, spacing, run.signal)
      .then((outcome) => {
        if (terrainRun !== run) return;
        terrainRun = null;
        set(outcome.ok
          ? { patternResult: outcome.result, isGenerating: false, terrainStatus: "idle" }
          : { patternResult: null, isGenerating: false, terrainStatus: "failed" });
      })
      .catch(() => {
        if (terrainRun !== run) return;
        terrainRun = null;
        set({ patternResult: null, isGenerating: false, terrainStatus: "failed" });
      });
  },

  clear: () => {
    // When a generated pattern is being cleared (e.g. after it is applied to
    // the mission), keep a faint outline of the input area so the operator can
    // still see where the pattern was placed. A discard with nothing generated
    // clears any lingering outline instead.
    const state = get();
    const captured = state.patternResult ? deriveInputGeometry(state) : null;
    cancelTerrainRun();
    set({ ...freshConfigs(), appliedBoundary: captured });
  },
}));
