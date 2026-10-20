/**
 * @module pattern-generation
 * @description The pattern store's one dispatcher from a pattern type to its
 * generator, plus geometry resolution: the patterns that take their area from
 * the drawing store (survey, orbit, structure scan, perimeter) fall back to
 * the last drawn shape when their config carries none.
 * @license GPL-3.0-only
 */

import type {
  SurveyConfig, OrbitConfig, CorridorConfig, FacadeConfig, PatternResult, PerimeterConfig,
  FixedWingLandingConfig, VtolLandingConfig, PatternAltitudeSettings,
} from "@/lib/patterns/types";
import type { ExpandingSquareConfig, SectorSearchConfig, ParallelTrackConfig } from "@/lib/patterns/sar-generators";
import type { StructureScanConfig } from "@/lib/patterns/structure-scan-generator";
import { generateSurvey, routeExit } from "@/lib/patterns/survey-generator";
import { generateOrbit } from "@/lib/patterns/orbit-generator";
import { generateStructureScan } from "@/lib/patterns/structure-scan-generator";
import { generatePerimeter } from "@/lib/patterns/perimeter-generator";
import { generateCorridor } from "@/lib/patterns/corridor-generator";
import { generateFacade } from "@/lib/patterns/facade-generator";
import { generateExpandingSquare, generateSectorSearch, generateParallelTrack } from "@/lib/patterns/sar-generators";
import { generateFixedWingLanding } from "@/lib/patterns/landing-generator";
import { generateVtolLanding } from "@/lib/patterns/vtol-landing-generator";
import { useDrawingStore } from "./drawing-store";
import type { PatternType } from "./pattern-store";

/** The per-pattern configs the dispatcher reads. */
export interface PatternConfigs {
  activePatternType: PatternType;
  surveyConfig: Partial<SurveyConfig>;
  exclusionPolygonIds: string[];
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
}

/** Dispatch pattern generation by type. Returns null if input geometry is missing. */
export function generatePattern(state: PatternConfigs): PatternResult | null {
  switch (state.activePatternType) {
    case "survey": return generateSurveyPattern(state.surveyConfig, state.exclusionPolygonIds);
    case "orbit": return generateOrbitPattern(state.orbitConfig);
    case "corridor": {
      const cfg = state.corridorConfig as CorridorConfig;
      return cfg.pathPoints && cfg.pathPoints.length >= 2 ? generateCorridor(cfg) : null;
    }
    case "facade": {
      const cfg = state.facadeConfig as FacadeConfig;
      return cfg.pathPoints && cfg.pathPoints.length >= 2 ? generateFacade(cfg) : null;
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

/**
 * The altitude reference of the active pattern and its camera trigger
 * distance, or null for a pattern that is always flown above home.
 */
export function activeAltitudeSettings(
  state: PatternConfigs,
): { settings: PatternAltitudeSettings; triggerDistance: number } | null {
  switch (state.activePatternType) {
    case "survey": return { settings: state.surveyConfig, triggerDistance: state.surveyConfig.cameraTriggerDistance ?? 0 };
    case "corridor": return { settings: state.corridorConfig, triggerDistance: state.corridorConfig.cameraTriggerDistance ?? 0 };
    case "structureScan": return { settings: state.structureScanConfig, triggerDistance: state.structureScanConfig.cameraTriggerDistance ?? 0 };
    case "facade": return { settings: state.facadeConfig, triggerDistance: state.facadeConfig.cameraTriggerDistance ?? 0 };
    default: return null;
  }
}

/** Merge multiple survey results into one combined result. */
function mergeSurveyResults(results: PatternResult[]): PatternResult {
  return {
    waypoints: results.flatMap((r) => r.waypoints),
    previewLines: results.flatMap((r) => r.previewLines ?? []),
    stats: {
      totalDistance: results.reduce((s, r) => s + r.stats.totalDistance, 0),
      estimatedTime: results.reduce((s, r) => s + r.stats.estimatedTime, 0),
      photoCount: results.reduce((s, r) => s + r.stats.photoCount, 0),
      coveredArea: results.reduce((s, r) => s + r.stats.coveredArea, 0),
      transectCount: results.reduce((s, r) => s + r.stats.transectCount, 0),
    },
  };
}

/** Generate a survey pattern, handling multi-polygon selection from drawing store. */
export function generateSurveyPattern(cfg: Partial<SurveyConfig>, exclusionIds: string[]): PatternResult | null {
  const fullCfg = cfg as SurveyConfig;
  const drawState = useDrawingStore.getState();

  // Resolve the marked exclusion (keep-out) rings from the drawn polygons.
  const exclusions: [number, number][][] = exclusionIds.length > 0
    ? drawState.polygons
        .filter((p) => exclusionIds.includes(p.id) && p.vertices.length >= 3)
        .map((p) => p.vertices)
    : [];

  if (fullCfg.polygon && fullCfg.polygon.length >= 3) {
    return generateSurvey({ ...fullCfg, exclusions });
  }
  const selectedIds = drawState.selectedPolygonIds;
  const candidate = selectedIds.length > 0
    ? drawState.polygons.filter((p) => selectedIds.includes(p.id))
    : drawState.polygons.slice(-1);
  // Exclusion polygons are keep-outs, never survey boundaries.
  const polygons = candidate.filter((p) => !exclusionIds.includes(p.id) && p.vertices.length >= 3);

  if (polygons.length === 1) {
    return generateSurvey({ ...fullCfg, polygon: polygons[0].vertices, exclusions });
  }
  if (polygons.length > 1) {
    // Each area starts where the previous one ended, so its line order and
    // the connecting leg (counted, and routed around keep-outs) follow on.
    const results: PatternResult[] = [];
    let exit: [number, number] | undefined;
    for (const p of polygons) {
      const result = generateSurvey({ ...fullCfg, polygon: p.vertices, exclusions }, exit);
      results.push(result);
      exit = routeExit(result) ?? exit;
    }
    return mergeSurveyResults(results);
  }
  return null;
}

/** Generate an orbit pattern, falling back to the last drawn circle. */
export function generateOrbitPattern(cfg: Partial<OrbitConfig>): PatternResult | null {
  const fullCfg = cfg as OrbitConfig;
  if (fullCfg.center) return generateOrbit(fullCfg);
  const drawState = useDrawingStore.getState();
  if (drawState.circles.length > 0) {
    const lastCircle = drawState.circles[drawState.circles.length - 1];
    return generateOrbit({ ...fullCfg, center: lastCircle.center, radius: lastCircle.radius ?? fullCfg.radius } as OrbitConfig);
  }
  return null;
}

/** Generate a structure scan, falling back to the last drawn polygon. */
export function generateStructureScanPattern(cfg: Partial<StructureScanConfig>): PatternResult | null {
  const fullCfg = cfg as StructureScanConfig;
  if (fullCfg.structurePolygon && fullCfg.structurePolygon.length >= 3) {
    return generateStructureScan(fullCfg);
  }
  const drawState = useDrawingStore.getState();
  const lastPoly = drawState.polygons[drawState.polygons.length - 1];
  if (lastPoly && lastPoly.vertices.length >= 3) {
    return generateStructureScan({ ...fullCfg, structurePolygon: lastPoly.vertices } as StructureScanConfig);
  }
  return null;
}

/** Generate a perimeter loop, falling back to the last drawn polygon. */
export function generatePerimeterPattern(cfg: Partial<PerimeterConfig>): PatternResult | null {
  const fullCfg = cfg as PerimeterConfig;
  if (fullCfg.polygon && fullCfg.polygon.length >= 3) return generatePerimeter(fullCfg);
  const drawState = useDrawingStore.getState();
  const lastPoly = drawState.polygons[drawState.polygons.length - 1];
  if (lastPoly && lastPoly.vertices.length >= 3) {
    return generatePerimeter({ ...fullCfg, polygon: lastPoly.vertices });
  }
  return null;
}
