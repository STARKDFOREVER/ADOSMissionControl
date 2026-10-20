/**
 * @module patterns/follow-terrain
 * @description Turn a pattern's heights into an altitude reference.
 *
 * Generators write every row's altitude as a height: above home in the
 * default mode, or above the ground under it in the terrain modes.
 * - Terrain frame: the rows are stamped `terrain` and the vehicle follows its
 *   own terrain data.
 * - Follow terrain: the planner samples the ground along every leg and writes
 *   absolute (sea-level) altitudes. A waypoint is added wherever the wanted
 *   height above ground would leave the straight line between two waypoints
 *   by more than the tolerance, and the path is raised where it would ask for
 *   a climb or descent steeper than the vehicle's limits at the pattern speed.
 *   Unknown ground anywhere fails the whole pattern: a terrain-following path
 *   is never written over ground the planner could not see.
 *
 * @license GPL-3.0-only
 */

import type { FollowTerrainOptions, PatternResult, PatternWaypoint } from "./types";
import { DEFAULT_FOLLOW_TERRAIN } from "./types";
import { isNavRow, navDistance } from "./local-geometry";
import { POSITION_BEARING_ACTIONS } from "@/lib/mission/command-classes";
import type { ActionCommand } from "@/lib/types";
import { interpolateLatLon } from "@/lib/geo/distance";
import { sampleGroundAlong } from "@/lib/terrain/ground-sampler";

/** The pattern stamped with ArduPilot's terrain frame (heights above ground). */
export function withTerrainFrame(result: PatternResult): PatternResult {
  return { ...result, waypoints: result.waypoints.map((row) => ({ ...row, frame: "terrain" })) };
}

export type FollowTerrainOutcome =
  | { ok: true; result: PatternResult }
  | { ok: false; reason: "terrainUnavailable" };

interface ProfilePoint {
  lat: number;
  lon: number;
  /** Horizontal distance from the previous profile point, metres. */
  stepM: number;
  /** Wanted absolute altitude, metres AMSL. */
  z: number;
  /** Speed of the leg into this point, m/s. */
  speed: number;
  /** Index of the navigation row this point is, or -1 for a sample between rows. */
  navIndex: number;
}

/**
 * Rewrite a pattern so it holds its height above ground, in absolute
 * altitudes. `sampleSpacingM` is the ground sampling step along each leg.
 */
export async function followTerrain(
  result: PatternResult,
  options: Partial<FollowTerrainOptions> | undefined,
  sampleSpacingM: number,
  signal?: AbortSignal,
): Promise<FollowTerrainOutcome> {
  const opts: FollowTerrainOptions = { ...DEFAULT_FOLLOW_TERRAIN, ...options };
  const rows = result.waypoints;
  const navIdx = rows.map((r, i) => (isNavRow(r) ? i : -1)).filter((i) => i >= 0);
  if (navIdx.length === 0) return { ok: true, result };

  // Ground along every leg (and under the lone first point), fetched together.
  const profile: ProfilePoint[] = [];
  const first = rows[navIdx[0]];
  const [[firstGround], ...legSamples] = await Promise.all([
    sampleGroundAlong(first, first, sampleSpacingM, signal),
    ...navIdx.slice(1).map((to, k) => sampleGroundAlong(rows[navIdx[k]], rows[to], sampleSpacingM, signal)),
  ]);
  if (firstGround.groundAmsl === null) return { ok: false, reason: "terrainUnavailable" };
  profile.push({ lat: first.lat, lon: first.lon, stepM: 0, z: firstGround.groundAmsl + first.alt, speed: first.speed, navIndex: navIdx[0] });
  for (let k = 1; k < navIdx.length; k++) {
    const from = rows[navIdx[k - 1]];
    const to = rows[navIdx[k]];
    const samples = legSamples[k - 1];
    const legM = samples[samples.length - 1].distM;
    for (let s = 1; s < samples.length; s++) {
      const ground = samples[s].groundAmsl;
      if (ground === null) return { ok: false, reason: "terrainUnavailable" };
      const t = legM > 0 ? samples[s].distM / legM : 1;
      const p = s === samples.length - 1 ? { lat: to.lat, lon: to.lon } : interpolateLatLon(from.lat, from.lon, to.lat, to.lon, t);
      profile.push({
        lat: p.lat, lon: p.lon,
        stepM: samples[s].distM - samples[s - 1].distM,
        z: ground + from.alt + (to.alt - from.alt) * t,
        speed: to.speed,
        navIndex: s === samples.length - 1 ? navIdx[k] : -1,
      });
    }
  }

  clampGradients(profile, opts);

  // Ground under each position-bearing action (an ROI aims at a height above it).
  const actionGround = new Map<number, number>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (isNavRow(row) || !POSITION_BEARING_ACTIONS.has(row.command as ActionCommand)) continue;
    const [g] = await sampleGroundAlong(row, row, sampleSpacingM, signal);
    if (g.groundAmsl === null) return { ok: false, reason: "terrainUnavailable" };
    actionGround.set(i, g.groundAmsl);
  }

  // Rebuild: each navigation row at its terrain altitude, its actions, then
  // the extra points the profile needs before the next navigation row.
  const keep = simplify(profile, opts.toleranceM);
  const zAtNav = new Map<number, number>();
  for (const p of profile) if (p.navIndex >= 0) zAtNav.set(p.navIndex, p.z);
  const extrasAfter = new Map<number, PatternWaypoint[]>();
  let lastNav = navIdx[0];
  profile.forEach((p, i) => {
    if (p.navIndex >= 0) { lastNav = p.navIndex; return; }
    if (!keep[i]) return;
    const list = extrasAfter.get(lastNav) ?? [];
    list.push({ lat: p.lat, lon: p.lon, alt: p.z, speed: p.speed, command: "WAYPOINT", frame: "absolute" });
    extrasAfter.set(lastNav, list);
  });

  const out: PatternWaypoint[] = [];
  let currentNavZ = zAtNav.get(navIdx[0]) ?? 0;
  let pendingExtras: PatternWaypoint[] = [];
  rows.forEach((row, i) => {
    if (isNavRow(row)) {
      out.push(...pendingExtras);
      currentNavZ = zAtNav.get(i) ?? currentNavZ;
      out.push({ ...row, alt: currentNavZ, frame: "absolute" });
      pendingExtras = extrasAfter.get(i) ?? [];
      return;
    }
    const ground = actionGround.get(i);
    out.push({ ...row, alt: ground !== undefined ? ground + row.alt : currentNavZ, frame: "absolute" });
  });
  out.push(...pendingExtras);

  const totalDistance = navDistance(out);
  const speed = first.speed;
  return {
    ok: true,
    result: {
      ...result,
      waypoints: out,
      stats: { ...result.stats, totalDistance, estimatedTime: speed > 0 ? totalDistance / speed : result.stats.estimatedTime },
    },
  };
}

/**
 * Raise the profile wherever it climbs or descends faster than the limits at
 * its leg speed. Only raises, so the height above ground never drops below
 * the wanted value. Climbs are fixed walking backwards (start climbing
 * earlier), descents walking forwards (descend later).
 */
function clampGradients(profile: ProfilePoint[], opts: FollowTerrainOptions): void {
  for (let i = profile.length - 2; i >= 0; i--) {
    const next = profile[i + 1];
    if (!(next.speed > 0)) continue;
    const maxRise = (opts.maxClimbMps * next.stepM) / next.speed;
    profile[i].z = Math.max(profile[i].z, next.z - maxRise);
  }
  for (let i = 1; i < profile.length; i++) {
    const cur = profile[i];
    if (!(cur.speed > 0)) continue;
    const maxDrop = (opts.maxDescentMps * cur.stepM) / cur.speed;
    cur.z = Math.max(cur.z, profile[i - 1].z - maxDrop);
  }
}

/**
 * Which profile points to keep: every navigation row, plus the points needed
 * so straight lines between kept points stay within `tolerance` of the
 * profile. Greedy: from each kept point, reach as far as possible.
 */
function simplify(profile: readonly ProfilePoint[], tolerance: number): boolean[] {
  const keep = profile.map((p) => p.navIndex >= 0);
  // Cumulative horizontal distance for interpolation.
  const at: number[] = [];
  profile.forEach((p, i) => at.push(i === 0 ? 0 : at[i - 1] + p.stepM));
  const fits = (from: number, to: number) => {
    for (let k = from + 1; k < to; k++) {
      const span = at[to] - at[from];
      const t = span > 0 ? (at[k] - at[from]) / span : 0;
      const line = profile[from].z + (profile[to].z - profile[from].z) * t;
      if (Math.abs(profile[k].z - line) > tolerance) return false;
    }
    return true;
  };
  let anchor = 0;
  while (anchor < profile.length - 1) {
    // The next navigation row bounds the reach: it is always kept.
    let limit = anchor + 1;
    while (limit < profile.length - 1 && !keep[limit]) limit++;
    let reach = anchor + 1;
    while (reach < limit && fits(anchor, reach + 1)) reach++;
    keep[reach] = true;
    anchor = reach;
  }
  return keep;
}
