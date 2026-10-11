/**
 * @module pattern-store
 * @description Zustand store for flight pattern generation state.
 * Holds config for each pattern type, the generated result, and actions
 * to update config, trigger generation, and clear.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type {
  SurveyConfig,
  OrbitConfig,
  CorridorConfig,
  PatternResult,
  PerimeterConfig,
  FixedWingLandingConfig,
  VtolLandingConfig,
} from "@/lib/patterns/types";
import type { ExpandingSquareConfig, SectorSearchConfig, ParallelTrackConfig } from "@/lib/patterns/sar-generators";
import type { StructureScanConfig } from "@/lib/patterns/structure-scan-generator";
import { generateCorridor } from "@/lib/patterns/corridor-generator";
import { generateExpandingSquare, generateSectorSearch, generateParallelTrack } from "@/lib/patterns/sar-generators";
import { generateFixedWingLanding } from "@/lib/patterns/landing-generator";
import { generateVtolLanding } from "@/lib/patterns/vtol-landing-generator";
import { offsetPoint } from "@/lib/drawing/geo-utils";
import { formatErrorMessage } from "@/lib/utils";
import { useDrawingStore } from "./drawing-store";
import {
  generateOrbitPattern,
  generatePerimeterPattern,
  generateStructureScanPattern,
  generateSurveyPattern,
} from "./pattern-generation";

export type PatternType = "survey" | "orbit" | "corridor" | "expandingSquare" | "sectorSearch" | "parallelTrack" | "structureScan" | "perimeter" | "fixedWingLanding" | "vtolLanding" | null;

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

interface PatternStoreState {
  activePatternType: PatternType;
  surveyConfig: Partial<SurveyConfig>;
  /** IDs of drawn polygons marked as survey exclusion (keep-out) zones. */
  exclusionPolygonIds: string[];
  /** Session flag: draw per-image camera footprints on the map (coverage preview). */
  showCoverageOverlay: boolean;
  orbitConfig: Partial<OrbitConfig>;
  corridorConfig: Partial<CorridorConfig>;
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
  error: string | null;

  setPatternType: (type: PatternType) => void;
  setAppliedBoundary: (boundary: AppliedBoundary | null) => void;
  clearAppliedBoundary: () => void;
  updateSurveyConfig: (update: Partial<SurveyConfig>) => void;
  setExclusionPolygonIds: (ids: string[]) => void;
  toggleExclusionPolygonId: (id: string) => void;
  setShowCoverageOverlay: (show: boolean) => void;
  updateOrbitConfig: (update: Partial<OrbitConfig>) => void;
  updateCorridorConfig: (update: Partial<CorridorConfig>) => void;
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

const defaultSurvey: Partial<SurveyConfig> = {
  gridAngle: 0,
  lineSpacing: 25,
  turnAroundDistance: 10,
  entryLocation: "topLeft",
  flyAlternateTransects: false,
  cameraTriggerDistance: 0,
  tieLines: false,
  tieLineAngle: 90,
  tieLineSpacing: 25,
  altitude: 50,
  speed: 5,
};

const defaultOrbit: Partial<OrbitConfig> = {
  radius: 50,
  direction: "cw",
  turns: 1,
  startAngle: 0,
  altitude: 50,
  speed: 5,
};

const defaultCorridor: Partial<CorridorConfig> = {
  corridorWidth: 50,
  lineSpacing: 20,
  altitude: 50,
  speed: 5,
};

const defaultExpandingSquare: Partial<ExpandingSquareConfig> = {
  legSpacing: 50,
  maxLegs: 20,
  altitude: 50,
  speed: 5,
  startBearing: 0,
};

const defaultSectorSearch: Partial<SectorSearchConfig> = {
  radius: 200,
  sweeps: 3,
  altitude: 50,
  speed: 5,
  startBearing: 0,
};

const defaultParallelTrack: Partial<ParallelTrackConfig> = {
  trackLength: 500,
  trackSpacing: 50,
  trackCount: 10,
  bearing: 0,
  altitude: 50,
  speed: 5,
};

const defaultStructureScan: Partial<StructureScanConfig> = {
  bottomAlt: 10,
  topAlt: 50,
  layerSpacing: 10,
  scanDistance: 15,
  gimbalPitch: -30,
  pointsPerLayer: 16,
  cameraTriggerDistance: 0,
  speed: 3,
  direction: "bottom-up",
};

const defaultPerimeter: Partial<PerimeterConfig> = {
  offsetM: 0,
  altitude: 50,
  speed: 5,
};

// No default approach heading: the final is flown along it, so the operator
// chooses it and no landing is generated until they do.
const defaultFixedWingLanding: Partial<FixedWingLandingConfig> = {
  glideSlopeAngle: 5,
  loiterAltitude: 60,
  speed: 15,
};

const defaultVtolLanding: Partial<VtolLandingConfig> = {
  transitionDistance: 150,
  approachAltitude: 50,
  descentSpeed: 2,
  speed: 8,
};

/** Dispatch pattern generation by type. Returns null if input geometry is missing. */
function generatePattern(state: PatternStoreState): PatternResult | null {
  switch (state.activePatternType) {
    case "survey": return generateSurveyPattern(state.surveyConfig, state.exclusionPolygonIds);
    case "orbit": return generateOrbitPattern(state.orbitConfig);
    case "corridor": {
      const cfg = state.corridorConfig as CorridorConfig;
      return cfg.pathPoints && cfg.pathPoints.length >= 2 ? generateCorridor(cfg) : null;
    }
    case "expandingSquare": {
      const cfg = state.sarExpandingSquareConfig as ExpandingSquareConfig;
      return cfg.center ? generateExpandingSquare(cfg) : null;
    }
    case "sectorSearch": {
      const cfg = state.sarSectorSearchConfig as SectorSearchConfig;
      return cfg.center ? generateSectorSearch(cfg) : null;
    }
    case "parallelTrack": {
      const cfg = state.sarParallelTrackConfig as ParallelTrackConfig;
      return cfg.startPoint ? generateParallelTrack(cfg) : null;
    }
    case "structureScan": return generateStructureScanPattern(state.structureScanConfig);
    case "perimeter": return generatePerimeterPattern(state.perimeterConfig);
    case "fixedWingLanding": {
      const cfg = state.fixedWingLandingConfig as FixedWingLandingConfig;
      return cfg.landingPoint ? generateFixedWingLanding(cfg) : null;
    }
    case "vtolLanding": {
      const cfg = state.vtolLandingConfig as VtolLandingConfig;
      return cfg.landingPoint ? generateVtolLanding(cfg) : null;
    }
    default: return null;
  }
}

const MISSING_GEOMETRY_MESSAGES: Record<string, string> = {
  survey: "Draw a polygon on the map first",
  orbit: "Draw a circle or click to set orbit center",
  corridor: "Draw the corridor path on the map first",
  expandingSquare: "Click map to set datum point",
  sectorSearch: "Click map to set datum point",
  parallelTrack: "Click map to set start point",
  structureScan: "Draw structure boundary polygon on map",
  perimeter: "Draw a polygon on the map first",
  fixedWingLanding: "Set the landing point first",
  vtolLanding: "Set the landing point first",
};

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

  switch (state.activePatternType) {
    case "survey": {
      const poly = state.surveyConfig.polygon && state.surveyConfig.polygon.length >= 3
        ? state.surveyConfig.polygon
        : drawnPolygon;
      return poly ? { kind: "polygon", positions: poly } : null;
    }
    case "structureScan": {
      const poly = state.structureScanConfig.structurePolygon && state.structureScanConfig.structurePolygon.length >= 3
        ? state.structureScanConfig.structurePolygon
        : drawnPolygon;
      return poly ? { kind: "polygon", positions: poly } : null;
    }
    case "perimeter": {
      const poly = state.perimeterConfig.polygon && state.perimeterConfig.polygon.length >= 3
        ? state.perimeterConfig.polygon
        : drawnPolygon;
      return poly ? { kind: "polygon", positions: poly } : null;
    }
    case "orbit": {
      const center = state.orbitConfig.center ?? lastCircle?.center ?? null;
      if (!center) return null;
      const radius = state.orbitConfig.radius ?? lastCircle?.radius ?? 50;
      return { kind: "circle", center, radius };
    }
    case "corridor": {
      const pts = state.corridorConfig.pathPoints;
      return pts && pts.length >= 2 ? { kind: "polyline", positions: pts } : null;
    }
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

export const usePatternStore = create<PatternStoreState>()((set, get) => ({
  activePatternType: null,
  surveyConfig: { ...defaultSurvey },
  exclusionPolygonIds: [],
  showCoverageOverlay: false,
  orbitConfig: { ...defaultOrbit },
  corridorConfig: { ...defaultCorridor },
  sarExpandingSquareConfig: { ...defaultExpandingSquare },
  sarSectorSearchConfig: { ...defaultSectorSearch },
  sarParallelTrackConfig: { ...defaultParallelTrack },
  structureScanConfig: { ...defaultStructureScan },
  perimeterConfig: { ...defaultPerimeter },
  fixedWingLandingConfig: { ...defaultFixedWingLanding },
  vtolLandingConfig: { ...defaultVtolLanding },
  patternResult: null,
  appliedBoundary: null,
  isGenerating: false,
  error: null,

  setAppliedBoundary: (boundary) => set({ appliedBoundary: boundary }),
  clearAppliedBoundary: () => set({ appliedBoundary: null }),

  setPatternType: (type) => {
    // Clear any previously drawn shapes so the new pattern can't silently
    // regenerate over the last polygon/circle via the generator's fallback.
    useDrawingStore.getState().clearAll();
    set({
      activePatternType: type,
      patternResult: null,
      error: null,
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

    set({ isGenerating: true, error: null });

    try {
      const result = generatePattern(state);
      if (result === null) {
        set({ patternResult: null, isGenerating: false, error: MISSING_GEOMETRY_MESSAGES[state.activePatternType] ?? "Missing input geometry" });
      } else {
        set({ patternResult: result, isGenerating: false, error: null });
      }
    } catch (err) {
      set({ error: formatErrorMessage(err), patternResult: null, isGenerating: false });
    }
  },

  clear: () => {
    // When a generated pattern is being cleared (e.g. after it is applied to
    // the mission), keep a faint outline of the input area so the operator can
    // still see where the pattern was placed. A discard with nothing generated
    // clears any lingering outline instead.
    const state = get();
    const captured = state.patternResult ? deriveInputGeometry(state) : null;
    set({
      activePatternType: null,
      exclusionPolygonIds: [],
  showCoverageOverlay: false,
      surveyConfig: { ...defaultSurvey },
      orbitConfig: { ...defaultOrbit },
      corridorConfig: { ...defaultCorridor },
      sarExpandingSquareConfig: { ...defaultExpandingSquare },
      sarSectorSearchConfig: { ...defaultSectorSearch },
      sarParallelTrackConfig: { ...defaultParallelTrack },
      structureScanConfig: { ...defaultStructureScan },
      perimeterConfig: { ...defaultPerimeter },
      fixedWingLandingConfig: { ...defaultFixedWingLanding },
      vtolLandingConfig: { ...defaultVtolLanding },
      patternResult: null,
      appliedBoundary: captured,
      isGenerating: false,
      error: null,
    });
  },
}));
