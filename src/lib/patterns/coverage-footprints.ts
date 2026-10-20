/**
 * @module patterns/coverage-footprints
 * @description Builds the ground footprint polygon of each survey image so the
 * planner can draw a coverage overlay — the actual rectangles the camera captures
 * along the route, revealing overlap and gaps. Pure geometry: the route's
 * camera-trigger actions give the capture points, and each gets a `width x
 * height` metre rectangle (from the camera + its altitude via
 * {@link computeFootprint}) rotated to its leg heading. No store access, no side
 * effects.
 * @license GPL-3.0-only
 */

import { offsetPoint, bearing } from "@/lib/drawing/geo-utils";
import { isActionCommand } from "@/lib/mission/command-classes";
import type { WaypointCommand } from "@/lib/types";
import { computeFootprint, type CameraOrientation, type CameraProfile } from "@/lib/patterns/gsd-calculator";
import { haversineDistance } from "@/lib/geo/distance";

/** A route row as the pattern generators emit it: a nav point or an attached action. */
export interface CaptureRouteRow {
  lat: number;
  lon: number;
  alt: number;
  command: string;
  param1?: number;
  /** On a camera trigger: 1 asks for one photo right away, at the point it fires. */
  param3?: number;
}

/** Where the camera fires: position, altitude and the heading of the leg it fires on. */
export interface CapturePoint {
  lat: number;
  lon: number;
  alt: number;
  headingDeg: number;
}

/** Default safety cap on drawn footprints, so a huge route cannot lock the map. */
export const MAX_FOOTPRINTS = 2000;

/**
 * Ground footprint of one image as four `[lat, lon]` corners (clockwise from the
 * forward-right), centred on `(lat, lon)`, `widthM` across-track by `heightM`
 * along-track, rotated so `headingDeg` points along-track.
 */
export function buildFootprintPolygon(
  lat: number,
  lon: number,
  headingDeg: number,
  widthM: number,
  heightM: number,
): [number, number][] {
  const halfAlong = heightM / 2;
  const halfAcross = widthM / 2;
  // Corner = step along-track (heading) then across-track (heading + 90).
  const corner = (along: number, across: number): [number, number] => {
    const [la, lo] = offsetPoint(lat, lon, headingDeg, along);
    return offsetPoint(la, lo, headingDeg + 90, across);
  };
  return [
    corner(halfAlong, halfAcross),
    corner(halfAlong, -halfAcross),
    corner(-halfAlong, -halfAcross),
    corner(-halfAlong, halfAcross),
  ];
}

/**
 * The capture points a route produces. A `DO_SET_CAM_TRIGG` with a positive
 * distance arms the camera at the nav point it rides; from there a capture
 * lands every `distance` metres along each following leg (the distance carries
 * across turns) until a zero-distance trigger disarms it. A trigger with
 * param3 = 1 also takes one photo where it fires (ArduPilot and PX4 shoot at
 * the arming or disarming point only when asked). Each capture takes the
 * altitude interpolated along its leg and the leg's heading.
 *
 * Only the first `maxCount` points are returned; `total` is the full count so
 * the caller can say when the overlay is truncated.
 */
export function sampleCapturePoints(
  route: readonly CaptureRouteRow[],
  maxCount = MAX_FOOTPRINTS,
): { points: CapturePoint[]; total: number } {
  const points: CapturePoint[] = [];
  let total = 0;
  let spacing = 0;
  // Distance flown since the last capture while the camera is armed.
  let sinceLast = 0;
  let prev: CaptureRouteRow | null = null;
  let lastHeading = 0;

  for (const row of route) {
    if (row.command === "DO_SET_CAM_TRIGG") {
      const next = row.param1 ?? 0;
      const shootNow = row.param3 === 1;
      if (next > 0 && spacing <= 0) {
        // An immediate shot lands at the arming point (distance 0 on the next leg).
        sinceLast = shootNow ? next : 0;
      } else if (next <= 0 && spacing > 0 && shootNow && prev) {
        total++;
        if (points.length < maxCount) points.push({ lat: prev.lat, lon: prev.lon, alt: prev.alt, headingDeg: lastHeading });
      }
      spacing = next > 0 ? next : 0;
      continue;
    }
    if (row.command === "DO_DIGICAM") {
      // A single shot where the aircraft is (hover-and-capture).
      if (prev) {
        total++;
        if (points.length < maxCount) points.push({ lat: prev.lat, lon: prev.lon, alt: prev.alt, headingDeg: lastHeading });
      }
      continue;
    }
    if (isActionCommand((row.command || "WAYPOINT") as WaypointCommand)) continue;
    if (prev && spacing > 0) {
      const legM = haversineDistance(prev.lat, prev.lon, row.lat, row.lon);
      const headingDeg = legM > 0 ? bearing(prev.lat, prev.lon, row.lat, row.lon) : lastHeading;
      let d = spacing - sinceLast; // distance along this leg to the next capture
      while (d <= legM && points.length < maxCount) {
        const f = legM > 0 ? d / legM : 0;
        points.push({
          lat: prev.lat + (row.lat - prev.lat) * f,
          lon: prev.lon + (row.lon - prev.lon) * f,
          alt: prev.alt + (row.alt - prev.alt) * f,
          headingDeg,
        });
        total++;
        d += spacing;
      }
      // Past the cap, count the rest of the leg's captures without building them.
      if (d <= legM) {
        const rest = Math.floor((legM - d) / spacing) + 1;
        total += rest;
        d += rest * spacing;
      }
      sinceLast = legM - (d - spacing);
      lastHeading = headingDeg;
    } else if (prev) {
      const legM = haversineDistance(prev.lat, prev.lon, row.lat, row.lon);
      if (legM > 0) lastHeading = bearing(prev.lat, prev.lon, row.lat, row.lon);
    }
    prev = row;
  }
  return { points, total };
}

/**
 * Build the ground footprint of every capture point, each sized for its own
 * altitude and aligned with its leg. Points at or below zero altitude draw
 * nothing (never a fabricated footprint).
 */
export function buildFootprintPolygons(
  points: readonly CapturePoint[],
  camera: CameraProfile,
  orientation: CameraOrientation = "landscape",
): [number, number][][] {
  const polys: [number, number][][] = [];
  for (const p of points) {
    if (!Number.isFinite(p.alt) || p.alt <= 0) continue;
    const { width, height } = computeFootprint(p.alt, camera, orientation);
    if (!(width > 0) || !(height > 0)) continue;
    polys.push(buildFootprintPolygon(p.lat, p.lon, p.headingDeg, width, height));
  }
  return polys;
}
