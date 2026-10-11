/**
 * @module pattern-generation
 * @description Geometry resolution for the pattern store's generators: the
 * patterns that take their area from the drawing store (survey, orbit,
 * structure scan, perimeter) fall back to the last drawn shape when their
 * config carries none.
 * @license GPL-3.0-only
 */

import type { SurveyConfig, OrbitConfig, PatternResult, PerimeterConfig } from "@/lib/patterns/types";
import type { StructureScanConfig } from "@/lib/patterns/structure-scan-generator";
import { generateSurvey } from "@/lib/patterns/survey-generator";
import { generateOrbit } from "@/lib/patterns/orbit-generator";
import { generateStructureScan } from "@/lib/patterns/structure-scan-generator";
import { generatePerimeter } from "@/lib/patterns/perimeter-generator";
import { useDrawingStore } from "./drawing-store";

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
  const polygons = candidate.filter((p) => !exclusionIds.includes(p.id));

  if (polygons.length === 1 && polygons[0].vertices.length >= 3) {
    return generateSurvey({ ...fullCfg, polygon: polygons[0].vertices, exclusions });
  }
  if (polygons.length > 1) {
    const results = polygons
      .filter((p) => p.vertices.length >= 3)
      .map((p) => generateSurvey({ ...fullCfg, polygon: p.vertices, exclusions }));
    return results.length > 0 ? mergeSurveyResults(results) : null;
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
