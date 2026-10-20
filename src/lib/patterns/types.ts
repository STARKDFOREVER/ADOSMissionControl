/**
 * @module patterns/types
 * @description Configuration and result types for automated flight pattern generators
 * (survey grid, orbit, corridor scan, facade scan).
 * @license GPL-3.0-only
 */

import type { AltitudeFrame } from "@/lib/types";
import type { CameraOrientation } from "./gsd-calculator";

// ── Shared pattern settings ──────────────────────────────────

/**
 * How a pattern's altitudes are referenced.
 * - `relative`: height above home, the plan's flat-ground assumption.
 * - `terrain`: ArduPilot's terrain frame; the altitude is height above the ground
 *   under each waypoint and the vehicle follows its own terrain data.
 * - `followTerrain`: the planner samples the ground along every leg and writes
 *   absolute (sea-level) altitudes that hold the height above ground.
 */
export type PatternAltitudeMode = "relative" | "terrain" | "followTerrain";

/** Limits the planner holds when it writes a terrain-following path. */
export interface FollowTerrainOptions {
  /** Largest height-above-ground error allowed between two waypoints, metres. */
  toleranceM: number;
  /** Steepest climb the path may ask for, m/s at the pattern speed. */
  maxClimbMps: number;
  /** Steepest descent the path may ask for, m/s at the pattern speed. */
  maxDescentMps: number;
}

export const DEFAULT_FOLLOW_TERRAIN: FollowTerrainOptions = { toleranceM: 10, maxClimbMps: 2.5, maxDescentMps: 1.5 };

/** Altitude reference shared by the survey, corridor, structure and facade patterns. */
export interface PatternAltitudeSettings {
  /** Absent means `relative`. */
  altitudeMode?: PatternAltitudeMode;
  /** Used when `altitudeMode` is `followTerrain`; absent fields take the defaults. */
  followTerrain?: Partial<FollowTerrainOptions>;
}

/**
 * The planner's camera helper fields on a pattern config. The generator reads
 * only the spacings the planner derives from them; these record where the
 * spacings came from so the editor can show and recompute them.
 */
export interface PatternCameraSettings {
  /** Selected camera profile name; empty or absent = manual spacing. */
  _cameraName?: string;
  /** Side overlap, percent. */
  _sidelap?: number;
  /** Front overlap, percent. */
  _frontlap?: number;
  /** Camera mounting orientation; absent = landscape. */
  _orientation?: CameraOrientation;
}

/** Capture behaviour shared by the camera patterns. */
export interface PatternCaptureSettings {
  /**
   * Stop at every capture point (1 s hold) and take one photo, instead of
   * shooting on distance while moving. Multirotor and VTOL only.
   */
  hoverAndCapture?: boolean;
}

// ── Survey (grid / lawnmower) ────────────────────────────────

export interface SurveyConfig extends PatternAltitudeSettings, PatternCameraSettings, PatternCaptureSettings {
  /** Polygon vertices as [lat, lon] pairs. */
  polygon: [number, number][];
  /** Compass bearing of the grid lines, degrees from north (0 = north-south lines, 90 = east-west). */
  gridAngle: number;
  /** Distance between parallel transects in meters. */
  lineSpacing: number;
  /** Overshoot distance past polygon boundary at each transect end, in meters. */
  turnAroundDistance: number;
  /** Which corner of the bounding box to start from. */
  entryLocation: "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
  /**
   * Fly every other line on the way out and the skipped lines on the way
   * back, so no turn is tighter than two line spacings.
   */
  flyAlternateTransects: boolean;
  /** Distance between camera triggers in meters (0 = disabled). */
  cameraTriggerDistance: number;
  /** Enable crosshatch: run survey twice at gridAngle and gridAngle+90. */
  crosshatch?: boolean;
  /** Enable tie lines (second pass at configurable angle/spacing for mag surveys). */
  tieLines?: boolean;
  /** Tie line angle offset from main grid in degrees (default 90). */
  tieLineAngle?: number;
  /** Tie line spacing in meters (independent of main lineSpacing). */
  tieLineSpacing?: number;
  /** Height of the generated waypoints in meters: above home, or above ground in the terrain modes. */
  altitude: number;
  /** Cruise speed for generated waypoints, in m/s. */
  speed: number;
}

// ── Orbit (circle / point-of-interest) ───────────────────────

export interface OrbitConfig {
  /** Circle center as [lat, lon]. */
  center: [number, number];
  /** Circle radius in meters. */
  radius: number;
  /** Orbit direction. */
  direction: "cw" | "ccw";
  /** Number of full orbits. */
  turns: number;
  /** Start angle in degrees from north (0 = north, 90 = east). */
  startAngle: number;
  /** Altitude above home in meters (written in the `relative` frame). */
  altitude: number;
  /** Cruise speed in m/s. */
  speed: number;
  /**
   * Height of the point of interest the camera aims at, in the mission's
   * altitude frame (0 = the frame's ground datum). Defaults to 0.
   */
  targetHeight?: number;
}

// ── Perimeter (boundary loop) ────────────────────────────────

export interface PerimeterConfig {
  /** Boundary polygon vertices as [lat, lon] pairs. */
  polygon: [number, number][];
  /** Inward offset from the boundary in meters (0 flies the boundary itself). */
  offsetM: number;
  /** Altitude above home in meters (written in the `relative` frame). */
  altitude: number;
  /** Cruise speed in m/s. */
  speed: number;
}

// ── Corridor (path scan) ─────────────────────────────────────

export interface CorridorConfig extends PatternAltitudeSettings, PatternCameraSettings, PatternCaptureSettings {
  /** Center line of the corridor as [lat, lon] waypoints (2 or more). */
  pathPoints: [number, number][];
  /** Total corridor width in meters (extends half on each side). */
  corridorWidth: number;
  /** Distance between the lines flown along the corridor, in meters. */
  lineSpacing: number;
  /** Height of the generated waypoints in meters: above home, or above ground in the terrain modes. */
  altitude: number;
  /** Cruise speed in m/s. */
  speed: number;
  /** Overshoot past each line end before turning, in meters (default 0). */
  turnAroundDistance?: number;
  /** Distance between camera triggers in meters (0 or absent = disabled). */
  cameraTriggerDistance?: number;
}

// ── Facade (vertical scan of one wall) ───────────────────────

export interface FacadeConfig extends PatternAltitudeSettings, PatternCameraSettings, PatternCaptureSettings {
  /** The facade's base line as two [lat, lon] points. */
  pathPoints: [number, number][];
  /** Which side of the line (looking from the first point to the second) the aircraft flies on. */
  side: "left" | "right";
  /** Horizontal distance from the facade to the flight plane, meters. */
  distance: number;
  /** Lowest row height, meters. */
  bottomAlt: number;
  /** Highest row height, meters. */
  topAlt: number;
  /** Largest vertical distance between two rows, meters. */
  rowSpacing: number;
  /** Distance between camera triggers along a row in meters (0 = disabled). */
  cameraTriggerDistance: number;
  /** Cruise speed in m/s. */
  speed: number;
}

// ── SAR patterns (re-exported from sar-generators) ───────────

export type { ExpandingSquareConfig, SectorSearchConfig, ParallelTrackConfig } from "./sar-generators";

// ── Structure scan (re-exported from structure-scan-generator) ─

export type { StructureScanConfig } from "./structure-scan-generator";

// ── Fixed-Wing Landing ────────────────────────────────────────

export interface FixedWingLandingConfig {
  /** Landing point as [lat, lon]. */
  landingPoint: [number, number];
  /**
   * Final-approach heading in degrees true (0-360), the direction the aircraft
   * flies on final. Required: no landing is generated without one.
   */
  approachHeading: number;
  /**
   * Glide slope angle in degrees (2-15). Sets the approach distance, which is
   * `loiterAltitude / tan(glideSlopeAngle)`.
   */
  glideSlopeAngle: number;
  /** Approach altitude in meters, in the mission altitude frame. */
  loiterAltitude: number;
  /** Approach speed in m/s. */
  speed: number;
}

// ── VTOL Landing ──────────────────────────────────────────────

export interface VtolLandingConfig {
  /** Landing point as [lat, lon]. */
  landingPoint: [number, number];
  /**
   * Final-approach heading in degrees true (0-360). Required: no landing is
   * generated without one.
   */
  approachHeading: number;
  /** Distance from landing to transition start, in meters. */
  transitionDistance: number;
  /** Approach altitude in meters, in the mission altitude frame. */
  approachAltitude: number;
  /** Expected vertical descent speed in m/s, for the time estimate only. */
  descentSpeed: number;
  /** Cruise approach speed in m/s. */
  speed: number;
}

// ── Result types ─────────────────────────────────────────────

export interface PatternStats {
  /** Total flight distance in meters. */
  totalDistance: number;
  /** Estimated flight time in seconds. */
  estimatedTime: number;
  /** Number of camera trigger events (0 if triggers disabled). */
  photoCount: number;
  /** Covered area in square meters. */
  coveredArea: number;
  /** Number of transects generated. */
  transectCount: number;
  /** Number of search legs, for the patterns flown as legs rather than transects (SAR). */
  legCount?: number;
}

export interface PatternWaypoint {
  lat: number;
  lon: number;
  alt: number;
  speed: number;
  command: string;
  param1?: number;
  param2?: number;
  /** Third MAVLink parameter of an action row (e.g. a camera trigger's "shoot now"). */
  param3?: number;
  /** Fifth MAVLink parameter of a non-positional action row (e.g. DO_DIGICAM's shoot command). */
  param5?: number;
  /** Seconds to hold at a navigation row. */
  holdTime?: number;
  /** Altitude frame of the row; absent = above home. */
  frame?: AltitudeFrame;
}

export interface PatternResult {
  waypoints: PatternWaypoint[];
  stats: PatternStats;
  /** Transect preview lines for map overlay: [[startLat, startLon], [endLat, endLon]]. */
  previewLines?: [[number, number], [number, number]][];
}

// ── Generation limits ────────────────────────────────────────

/** Smallest line, leg or track spacing (and trigger distance) a generator accepts, meters. */
export const MIN_LINE_SPACING_M = 0.5;
/** Upper bound on transects (or legs/tracks) per generated pattern. */
export const MAX_TRANSECTS = 2000;
/** Upper bound on estimated camera triggers per generated pattern. */
export const MAX_PHOTOS = 100_000;

/**
 * Thrown when a pattern config would produce an unbounded amount of work
 * (tiny spacing over a large area). The pattern store surfaces the message.
 */
export class PatternLimitError extends Error {
  constructor(
    readonly limit: "spacing" | "transects" | "photos",
    message: string,
  ) {
    super(message);
    this.name = "PatternLimitError";
  }
}

/** Parse a spacing input; empty or invalid falls back, anything below the minimum clamps up. */
export function parseSpacing(raw: string, fallback: number): number {
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.max(MIN_LINE_SPACING_M, v);
}

/** Reject a spacing below {@link MIN_LINE_SPACING_M}. */
export function assertSpacing(spacing: number, label: string): void {
  if (spacing < MIN_LINE_SPACING_M) {
    throw new PatternLimitError(
      "spacing",
      `${label} ${spacing} m is below the ${MIN_LINE_SPACING_M} m minimum`,
    );
  }
}

/** Reject a pattern that would need more than {@link MAX_TRANSECTS} transects. */
export function assertTransectCount(count: number): void {
  if (count > MAX_TRANSECTS) {
    throw new PatternLimitError(
      "transects",
      `pattern needs ${Math.ceil(count)} transects (limit ${MAX_TRANSECTS}); increase the spacing`,
    );
  }
}

/** Reject a pattern that would trigger the camera more than {@link MAX_PHOTOS} times. */
export function assertPhotoCount(count: number): void {
  if (count > MAX_PHOTOS) {
    throw new PatternLimitError(
      "photos",
      `pattern needs ${Math.ceil(count)} photos (limit ${MAX_PHOTOS}); increase the trigger distance`,
    );
  }
}
