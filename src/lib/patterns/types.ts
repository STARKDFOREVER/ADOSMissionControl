/**
 * @module patterns/types
 * @description Configuration and result types for automated flight pattern generators
 * (survey grid, orbit, corridor scan).
 * @license GPL-3.0-only
 */

// ── Survey (grid / lawnmower) ────────────────────────────────

export interface SurveyConfig {
  /** Polygon vertices as [lat, lon] pairs. */
  polygon: [number, number][];
  /** Grid rotation angle in degrees (0 = east-west lines, 90 = north-south). */
  gridAngle: number;
  /** Distance between parallel transects in meters. */
  lineSpacing: number;
  /** Overshoot distance past polygon boundary at each transect end, in meters. */
  turnAroundDistance: number;
  /** Which corner of the bounding box to start from. */
  entryLocation: "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
  /** Skip every other transect (useful for double-pass surveys). */
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
  /** Altitude above home for generated waypoints, in meters (written in the `relative` frame). */
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

export interface CorridorConfig {
  /** Center line of the corridor as [lat, lon] waypoints. */
  pathPoints: [number, number][];
  /** Total corridor width in meters (extends half on each side). */
  corridorWidth: number;
  /** Distance between perpendicular transects in meters. */
  lineSpacing: number;
  /** Altitude above home in meters (written in the `relative` frame). */
  altitude: number;
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
}

export interface PatternWaypoint {
  lat: number;
  lon: number;
  alt: number;
  speed: number;
  command: string;
  param1?: number;
  param2?: number;
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
