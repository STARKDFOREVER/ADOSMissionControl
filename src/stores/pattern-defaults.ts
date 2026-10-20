/**
 * @module pattern-defaults
 * @description Starting configuration of every flight pattern. Pattern config
 * is never persisted, so these apply to each new pattern session.
 * @license GPL-3.0-only
 */

import type {
  SurveyConfig,
  OrbitConfig,
  CorridorConfig,
  FacadeConfig,
  PerimeterConfig,
  FixedWingLandingConfig,
  VtolLandingConfig,
} from "@/lib/patterns/types";
import type { ExpandingSquareConfig, SectorSearchConfig, ParallelTrackConfig } from "@/lib/patterns/sar-generators";
import type { StructureScanConfig } from "@/lib/patterns/structure-scan-generator";

export const defaultSurvey: Partial<SurveyConfig> = {
  // East-west lines.
  gridAngle: 90,
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

export const defaultOrbit: Partial<OrbitConfig> = {
  radius: 50,
  direction: "cw",
  turns: 1,
  startAngle: 0,
  altitude: 50,
  speed: 5,
};

export const defaultCorridor: Partial<CorridorConfig> = {
  corridorWidth: 50,
  lineSpacing: 20,
  turnAroundDistance: 10,
  cameraTriggerDistance: 0,
  altitude: 50,
  speed: 5,
};

export const defaultFacade: Partial<FacadeConfig> = {
  side: "right",
  distance: 20,
  bottomAlt: 10,
  topAlt: 40,
  rowSpacing: 10,
  cameraTriggerDistance: 0,
  speed: 3,
};

export const defaultExpandingSquare: Partial<ExpandingSquareConfig> = {
  legSpacing: 50,
  maxLegs: 20,
  altitude: 50,
  speed: 5,
  startBearing: 0,
};

export const defaultSectorSearch: Partial<SectorSearchConfig> = {
  radius: 200,
  altitude: 50,
  speed: 5,
  startBearing: 0,
};

export const defaultParallelTrack: Partial<ParallelTrackConfig> = {
  trackLength: 500,
  trackSpacing: 50,
  trackCount: 10,
  bearing: 0,
  altitude: 50,
  speed: 5,
};

export const defaultStructureScan: Partial<StructureScanConfig> = {
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

export const defaultPerimeter: Partial<PerimeterConfig> = {
  offsetM: 0,
  altitude: 50,
  speed: 5,
};

// No default approach heading: the final is flown along it, so the operator
// chooses it and no landing is generated until they do.
export const defaultFixedWingLanding: Partial<FixedWingLandingConfig> = {
  glideSlopeAngle: 5,
  loiterAltitude: 60,
  speed: 15,
};

export const defaultVtolLanding: Partial<VtolLandingConfig> = {
  transitionDistance: 150,
  approachAltitude: 50,
  descentSpeed: 2,
  speed: 8,
};
