/**
 * @module terrain/rtl-advisory
 * @description Terrain-relative Return-To-Launch (RTL) / failsafe advisory. When a
 * failsafe fires, the autopilot climbs to a fixed return altitude (taken relative
 * to home, and capped by an ArduPilot altitude fence) and flies a STRAIGHT line to
 * its return point: the closest rally point the autopilot's rally rules allow,
 * else home (see `mission/rtl-target`). That straight leg is not part of the
 * planned mission, so terrain the mission never overflew can rise into it: if the
 * terrain along the direct return line plus a safety buffer exceeds the return
 * cruise altitude, the aircraft would clip it on the way back.
 *
 * This module checks, for every waypoint (any of which could be the point where a
 * failsafe triggers), whether the direct return leg to its return point keeps the
 * required clearance above terrain. Terrain along a leg is estimated by linear interpolation
 * between the endpoint ground-elevation samples we hold (the waypoint's and home's).
 * That reliably catches the dominant real hazard: RTL_ALT set too low for terrain
 * the mission flies over. A denser terrain field would additionally catch a hill
 * that sits between the endpoints but is under neither; that is noted as a known
 * limitation of the endpoint-sample model.
 *
 * Pure module: no React, no store, no I/O, no Leaflet — fully unit-testable.
 * @license GPL-3.0-only
 */

import {
  DEFAULT_MIN_TERRAIN_CLEARANCE,
  findCollisionSegments,
  type ClearanceSample,
} from "@/lib/terrain/terrain-clearance";
import type { Waypoint } from "@/lib/types";
import { haversineDistance } from "@/lib/geo/distance";
import { rtlTarget, type RtlTarget, type RtlTargetRules } from "@/lib/mission/rtl-target";

/** Severity of an RTL terrain advisory. Mirrors the airspace-check convention. */
export type RtlAdvisoryLevel = "warn" | "error";

/** A single RTL-return terrain finding. */
export interface RtlAdvisoryIssue {
  /** `"error"` when the return cruise sits below terrain, `"warn"` when it is within the clearance buffer. */
  level: RtlAdvisoryLevel;
  /** Human-readable summary. */
  message: string;
  /** Horizontal length of the return leg from the trigger waypoint to its return point (kilometers). */
  distanceKm: number;
  /** Index of the waypoint whose return leg raised the issue. */
  waypointIndex: number;
  /** Where the return leg goes. */
  target: RtlTarget;
}

/** A rally point with the terrain elevation (metres MSL) under it, when sampled. */
export interface RtlRallyPoint {
  lat: number;
  lon: number;
  groundElevation?: number;
}

/** How the autopilot picks its return point and altitude. */
export interface RtlReturnModel {
  /** Rally points the RTL may return to. */
  rally?: readonly RtlRallyPoint[];
  /** The autopilot's rally rules; absent, every return goes home. */
  rules?: RtlTargetRules;
  /** Return altitude ceiling (fence maximum minus margin), metres above home. */
  ceilingM?: number;
}

/** Home / launch point with the terrain elevation beneath it. */
export interface RtlHomePoint {
  lat: number;
  lon: number;
  /** Terrain elevation MSL at home, in metres. */
  groundElevation: number;
}

/** Spacing (metres) between interpolated terrain samples along a return leg. */
const RETURN_LEG_SAMPLE_SPACING_M = 250;
/** Minimum number of intermediate samples between the leg endpoints. */
const MIN_INTERMEDIATE_SAMPLES = 3;

/** Linear interpolation between two values. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Build the clearance profile along one straight return leg. The return cruise
 * holds a constant MSL altitude (`cruiseMsl`); terrain along the leg is linearly
 * interpolated between the two endpoint elevations. Each sample's `agl` is the
 * clearance of the cruise path above terrain (may be negative when below terrain).
 */
function buildLegSamples(
  legDistanceM: number,
  triggerGroundElev: number,
  homeGroundElev: number,
  cruiseMsl: number,
): ClearanceSample[] {
  const intermediate = Math.max(
    MIN_INTERMEDIATE_SAMPLES,
    Math.ceil(legDistanceM / RETURN_LEG_SAMPLE_SPACING_M),
  );
  // steps = intermediate samples + 1, giving steps + 1 points (both endpoints included).
  const steps = intermediate + 1;
  const samples: ClearanceSample[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const terrain = lerp(triggerGroundElev, homeGroundElev, t);
    samples.push({ distance: legDistanceM * t, agl: cruiseMsl - terrain });
  }
  return samples;
}

/** The return altitude the vehicle actually flies: the configured one, capped by the fence ceiling. */
export function effectiveReturnAltitude(rtlAltitudeM: number, ceilingM?: number): number {
  return ceilingM !== undefined && Number.isFinite(ceilingM) ? Math.min(rtlAltitudeM, ceilingM) : rtlAltitudeM;
}

/**
 * Check whether a straight RTL / failsafe return leg from each mission waypoint to
 * its return point would clip terrain.
 *
 * The return cruise altitude is `home.groundElevation + min(rtlAltitudeM, ceiling)`
 * (RTL altitude is relative to home, per the ArduPilot / PX4 convention). For each
 * waypoint whose ground elevation is known, the return point is the one the
 * autopilot picks from there (a rally point or home); the direct leg to it is
 * sampled and compared against terrain plus `minClearanceM`. A return to a rally
 * point whose ground is not known is not checked. An issue is emitted per waypoint
 * whose return leg breaches the clearance floor: `"error"` when the cruise path is
 * actually below terrain, `"warn"` when it clears terrain but by less than the
 * buffer. The message names the return point.
 *
 * @param waypoints ordered mission waypoints (each may carry `groundElevation`)
 * @param home planned home with terrain elevation MSL
 * @param rtlAltitudeM configured return altitude above home, in metres
 * @param minClearanceM required clearance above terrain, in metres
 * @param model rally points, rally rules and the fence ceiling
 * @returns issues, most severe first (errors before warns, then least clearance,
 *   then longest leg). Empty when home elevation or the RTL altitude is unusable.
 */
export function checkRtlTerrainClearance(
  waypoints: readonly Waypoint[],
  home: RtlHomePoint,
  rtlAltitudeM: number,
  minClearanceM: number = DEFAULT_MIN_TERRAIN_CLEARANCE,
  model: RtlReturnModel = {},
): RtlAdvisoryIssue[] {
  if (
    !Number.isFinite(home.groundElevation) ||
    !Number.isFinite(home.lat) ||
    !Number.isFinite(home.lon) ||
    !Number.isFinite(rtlAltitudeM)
  ) {
    return [];
  }

  const cruiseMsl = home.groundElevation + effectiveReturnAltitude(rtlAltitudeM, model.ceilingM);
  const rally = model.rally ?? [];

  // Intermediate rows carry the worst clearance so we can sort by severity.
  const rows: Array<RtlAdvisoryIssue & { worstClearance: number }> = [];

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (
      !Number.isFinite(wp.groundElevation as number) ||
      !Number.isFinite(wp.lat) ||
      !Number.isFinite(wp.lon)
    ) {
      continue;
    }
    const triggerGroundElev = wp.groundElevation as number;
    const target: RtlTarget = model.rules
      ? rtlTarget(wp, home, rally, model.rules)
      : { kind: "home", lat: home.lat, lon: home.lon };
    const targetGround = target.kind === "home" ? home.groundElevation : rally[target.rallyIndex].groundElevation;
    if (targetGround === undefined || !Number.isFinite(targetGround)) continue;

    const legDistanceM = haversineDistance(wp.lat, wp.lon, target.lat, target.lon);
    const samples = buildLegSamples(
      legDistanceM,
      triggerGroundElev,
      targetGround,
      cruiseMsl,
    );

    const segments = findCollisionSegments(samples, minClearanceM);
    if (segments.length === 0) continue;

    // Worst (lowest) clearance across the whole leg.
    let worstClearance = Infinity;
    for (const seg of segments) {
      if (seg.minAgl < worstClearance) worstClearance = seg.minAgl;
    }

    // The breaching terrain height that produced the worst clearance.
    const terrainPeakMsl = cruiseMsl - worstClearance;
    const level: RtlAdvisoryLevel = worstClearance < 0 ? "error" : "warn";
    const distanceKm = Math.round((legDistanceM / 1000) * 10) / 10;
    const wpLabel = `WP${i + 1}`;
    const legName = target.kind === "home" ? "the direct leg home" : `the direct leg to rally point ${target.rallyIndex + 1}`;
    const returnTo = target.kind === "home" ? "home" : `rally point ${target.rallyIndex + 1}`;

    let message: string;
    if (level === "error") {
      const below = Math.round(-worstClearance);
      message =
        `RTL from ${wpLabel} (return to ${returnTo}) would clip terrain: the ${Math.round(cruiseMsl)} m MSL ` +
        `return cruise is ${below} m below the ${Math.round(terrainPeakMsl)} m terrain ` +
        `on ${legName}. Raise the RTL return altitude.`;
    } else {
      const clear = Math.round(worstClearance);
      message =
        `RTL from ${wpLabel} (return to ${returnTo}) runs close to terrain: the return cruise clears ground by ` +
        `only ${clear} m on ${legName} (want ${Math.round(minClearanceM)} m). ` +
        `Consider raising the RTL return altitude.`;
    }

    rows.push({ level, message, distanceKm, waypointIndex: i, target, worstClearance });
  }

  rows.sort((a, b) => {
    // Errors before warnings.
    const rank = (r: typeof a) => (r.level === "error" ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    // Then least clearance (most severe breach) first.
    if (a.worstClearance !== b.worstClearance) return a.worstClearance - b.worstClearance;
    // Then longest leg first (more exposure).
    return b.distanceKm - a.distanceKm;
  });

  return rows.map(({ worstClearance: _worstClearance, ...issue }) => issue);
}
