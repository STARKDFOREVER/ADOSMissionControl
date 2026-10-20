/**
 * @module terrain/ground-sampler
 * @description Ground elevation sampled at even spacing along a straight leg.
 *
 * One sampler feeds the leg terrain-clearance check, terrain-following pattern
 * generation and the terrain profile, so all three see the same ground at the
 * same points. Samples run through the cached elevation provider (memory, then
 * the persistent cache, then the API), and a failed lookup stays `null`: an
 * unknown ground is never reported as sea level.
 *
 * @license GPL-3.0-only
 */

import { haversineDistance, interpolateLatLon } from "@/lib/geo/distance";
import { getElevations } from "./terrain-provider";

export interface GroundSample {
  /** Distance from `a` along the leg, metres. */
  distM: number;
  /** Ground elevation, metres AMSL; `null` when the lookup failed. */
  groundAmsl: number | null;
}

/**
 * Evenly spaced points from `a` to `b`, both endpoints included, no two
 * neighbours farther apart than `spacingM`. A zero-length leg yields the two
 * (coincident) endpoints.
 */
export function legSamplePoints(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  spacingM = 30,
): Array<{ lat: number; lon: number; distM: number }> {
  if (!(spacingM > 0) || !Number.isFinite(spacingM)) {
    throw new RangeError(`Sample spacing must be a positive number of metres, got ${spacingM}`);
  }
  const lengthM = haversineDistance(a.lat, a.lon, b.lat, b.lon);
  const segments = Math.max(1, Math.ceil(lengthM / spacingM));
  const points: Array<{ lat: number; lon: number; distM: number }> = [];
  for (let i = 0; i <= segments; i++) {
    if (i === 0) {
      points.push({ lat: a.lat, lon: a.lon, distM: 0 });
    } else if (i === segments) {
      points.push({ lat: b.lat, lon: b.lon, distM: lengthM });
    } else {
      const t = i / segments;
      const p = interpolateLatLon(a.lat, a.lon, b.lat, b.lon, t);
      points.push({ lat: p.lat, lon: p.lon, distM: lengthM * t });
    }
  }
  return points;
}

/**
 * Sample ground elevation along the straight leg `a` → `b` at most `spacingM`
 * apart, both endpoints included. Rejects with an `AbortError` when `signal`
 * aborts.
 */
export async function sampleGroundAlong(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  spacingM = 30,
  signal?: AbortSignal,
): Promise<Array<{ distM: number; groundAmsl: number | null }>> {
  const points = legSamplePoints(a, b, spacingM);
  const elevations = await getElevations(points, signal);
  return points.map((p, i) => ({ distM: p.distM, groundAmsl: elevations[i] }));
}
