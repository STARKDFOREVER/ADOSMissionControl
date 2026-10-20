/**
 * @module terrain/terrain-profile
 * @description Computes terrain elevation profiles along waypoint paths.
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import type { TerrainProfile, TerrainPoint, TerrainGap } from "./types";
import { getElevations } from "./terrain-provider";
import { legSamplePoints } from "./ground-sampler";

/**
 * Compute a terrain elevation profile along a waypoint path.
 * Samples elevation at each waypoint and at evenly spaced points between
 * them, no two neighbours more than `spacingM` apart.
 *
 * @param waypoints Waypoint array to profile
 * @param spacingM Largest gap between neighbouring samples on a leg, metres
 * @param signal Optional AbortSignal for cancellation
 * @returns TerrainProfile with elevation data along the path and the gaps where
 *   the lookup failed, or `null` when the elevation data is unavailable
 *   (offline / every lookup failed) so callers can show an explicit
 *   "unavailable" state instead of a fabricated flat-0 profile.
 */
export async function computeTerrainProfile(
  waypoints: Waypoint[],
  spacingM = 30,
  signal?: AbortSignal,
): Promise<TerrainProfile | null> {
  if (waypoints.length === 0) {
    return { points: [], gaps: [], minElevation: 0, maxElevation: 0 };
  }

  // Build sample points: the first waypoint, then each leg's samples after its
  // start (the leg's end is the next waypoint).
  const first = waypoints[0];
  const samplePoints: Array<{ lat: number; lon: number; cumDist: number }> = [
    { lat: first.lat, lon: first.lon, cumDist: 0 },
  ];
  let cumDist = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const leg = legSamplePoints(waypoints[i - 1], waypoints[i], spacingM);
    for (let s = 1; s < leg.length; s++) {
      samplePoints.push({ lat: leg[s].lat, lon: leg[s].lon, cumDist: cumDist + leg[s].distM });
    }
    cumDist += leg[leg.length - 1].distM;
  }

  // Fetch elevations (null at any index whose lookup failed)
  const elevations = await getElevations(
    samplePoints.map((p) => ({ lat: p.lat, lon: p.lon })),
    signal,
  );

  // Build profile from the samples that actually resolved, and record every
  // run of failed samples as a gap so it is shown as unknown rather than
  // smoothed over. If none resolved, the terrain data is unavailable — return
  // null so the chart shows an explicit offline state rather than a false
  // sea-level baseline.
  let minElevation = Infinity;
  let maxElevation = -Infinity;
  const points: TerrainPoint[] = [];
  const gaps: TerrainGap[] = [];
  let gapStart: number | null = null;

  for (let i = 0; i < samplePoints.length; i++) {
    const elev = elevations[i];
    const distance = samplePoints[i].cumDist;
    if (elev === null) {
      if (gapStart === null) gapStart = points.length > 0 ? points[points.length - 1].distance : distance;
      continue;
    }
    if (gapStart !== null) {
      gaps.push({ startDistance: gapStart, endDistance: distance });
      gapStart = null;
    }
    if (elev < minElevation) minElevation = elev;
    if (elev > maxElevation) maxElevation = elev;
    points.push({
      lat: samplePoints[i].lat,
      lon: samplePoints[i].lon,
      distance,
      elevation: elev,
    });
  }
  if (gapStart !== null) {
    gaps.push({ startDistance: gapStart, endDistance: samplePoints[samplePoints.length - 1].cumDist });
  }

  if (points.length === 0) return null;

  return { points, gaps, minElevation, maxElevation };
}
