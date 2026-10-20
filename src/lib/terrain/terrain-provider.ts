/**
 * @module terrain/terrain-provider
 * @description Elevation data fetcher using the Open Elevation API.
 *
 * Returns `null` for a failed lookup (offline / error / no result). That is the
 * whole contract: a genuine sea-level 0 m reading and "we have no idea" are
 * different facts, and a mission validated against a fabricated 0 m ground is
 * the worst kind of false green — every altitude looks safely clear of the sea.
 * `null` (rather than `NaN`) makes the unknown case a compile-time obligation
 * for every caller instead of a value that silently participates in arithmetic.
 *
 * Lookups resolve in three levels: an in-memory LRU (~10K entries), then the
 * persistent IndexedDB cache (`elevation-cache.ts`: exact cells from earlier
 * lookups, then posts from a downloaded area), then the API. Every API answer
 * is written through to both caches; a failed lookup is never cached, so it is
 * retried next time rather than remembered as unknown.
 *
 * Cache keys are a quantised grid CELL INDEX, not a rounded coordinate string.
 * The old 4-decimal (~11 m) rounding merged genuinely distinct planner points
 * into one cache entry, and the batch reader then matched responses back by
 * that same rounded coordinate — so two co-rounded points could be bound each
 * other's elevation. Batch responses are correlated by request INDEX, which is
 * the only correlation the API actually guarantees.
 *
 * @license GPL-3.0-only
 */

import {
  POST_DEG,
  interpolateFromPosts,
  persistentCacheAvailable,
  postIndexAbove,
  postIndexBelow,
  postKey,
  readCells,
  writeCells,
  writePosts,
} from "./elevation-cache";

const API_URL = "https://api.open-elevation.com/api/v1/lookup";
const MAX_CACHE_SIZE = 10_000;
const BATCH_CHUNK_SIZE = 100;

/** Largest area download, in lattice posts. */
export const MAX_PREFETCH_CELLS = 40_000;

/** North-south length of one arc-second, metres. */
const ARC_SECOND_M = POST_DEG * 111_320;

/**
 * Cache grid resolution in degrees. 1e-5° is ~1.1 m — over an order of
 * magnitude finer than the ~30 m SRTM-class DEM this API serves, so two
 * distinct planner points never collapse onto one sample, while a repeated
 * lookup of the same point still hits.
 */
const CACHE_GRID_DEG = 1e-5;

// LRU cache: Map preserves insertion order, oldest entries are first
const cache = new Map<string, number>();

/** Quantised grid cell index pair — an exact key, not a lossy rounded string. */
function cacheKey(lat: number, lon: number): string {
  return `${Math.round(lat / CACHE_GRID_DEG)}:${Math.round(lon / CACHE_GRID_DEG)}`;
}

function cacheSet(key: string, value: number): void {
  // If key already exists, delete to re-insert at end (most recent)
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  // Evict oldest entries if over capacity
  if (cache.size > MAX_CACHE_SIZE) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
}

function cacheGet(key: string): number | undefined {
  const val = cache.get(key);
  if (val !== undefined) {
    // Move to end (most recent)
    cache.delete(key);
    cache.set(key, val);
  }
  return val;
}

/**
 * Ask the API for every point, in chunks of 100. `null` at every index whose
 * chunk failed or whose result was missing. Rethrows `AbortError`.
 */
async function fetchFromApi(
  points: Array<{ lat: number; lon: number }>,
  signal?: AbortSignal,
): Promise<Array<number | null>> {
  const results = new Array<number | null>(points.length).fill(null);
  for (let start = 0; start < points.length; start += BATCH_CHUNK_SIZE) {
    const chunk = points.slice(start, start + BATCH_CHUNK_SIZE);
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locations: chunk.map((p) => ({ latitude: p.lat, longitude: p.lon })),
        }),
        signal,
      });
      if (!response.ok) {
        console.warn(`[terrain] Batch API returned ${response.status}`);
        continue; // this chunk's indices stay null
      }
      const data = await response.json() as {
        results?: Array<{ elevation?: number }>;
      };
      const resultsArr = data.results;
      if (!resultsArr || resultsArr.length !== chunk.length) {
        // Partial / truncated response: the server did not answer every point,
        // so index correlation is no longer meaningful for ANY of them. Leave
        // the whole chunk unknown rather than binding a possibly-wrong value.
        console.warn(
          `[terrain] Batch returned ${resultsArr?.length ?? 0} results for ${chunk.length} points — discarding the chunk`,
        );
        continue;
      }
      // The API answers in request order and guarantees nothing else, so index
      // is the only sound correlation. Matching by rounded coordinate (the old
      // behaviour) bound the wrong elevation whenever two requested points
      // shared a rounded key.
      for (let j = 0; j < chunk.length; j++) {
        const elev = resultsArr[j]?.elevation;
        if (typeof elev !== "number" || !Number.isFinite(elev)) continue;
        results[start + j] = elev;
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      console.warn("[terrain] Batch fetch failed:", err);
      // this chunk's indices stay null
    }
  }
  return results;
}

/**
 * Fetch elevations for multiple points in batch: memory, then the persistent
 * cache, then the API (chunked, max 100 per request). Returns `null` at every
 * index whose lookup failed; the returned array is always the same length and
 * order as `points`. Rejects with `AbortError` when `signal` aborts a request.
 */
export async function getElevations(
  points: Array<{ lat: number; lon: number }>,
  signal?: AbortSignal,
): Promise<Array<number | null>> {
  if (points.length === 0) return [];

  const results = new Array<number | null>(points.length).fill(null);
  const keys = points.map((p) => cacheKey(p.lat, p.lon));

  let pending: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const cached = cacheGet(keys[i]);
    if (cached !== undefined) results[i] = cached;
    else pending.push(i);
  }

  // Keep the indices a cache level could not answer; bind the ones it could.
  const settle = (values: Array<number | undefined>): number[] =>
    pending.filter((i, n) => {
      const v = values[n];
      if (v === undefined) return true;
      results[i] = v;
      cacheSet(keys[i], v);
      return false;
    });

  if (pending.length > 0) pending = settle(await readCells(pending.map((i) => keys[i])));
  if (pending.length > 0) pending = settle(await interpolateFromPosts(pending.map((i) => points[i])));
  if (pending.length === 0) return results;

  const fetched = await fetchFromApi(pending.map((i) => points[i]), signal);
  const resolved: Array<[string, number]> = [];
  pending.forEach((i, n) => {
    const elev = fetched[n];
    if (elev === null) return;
    results[i] = elev;
    cacheSet(keys[i], elev);
    resolved.push([keys[i], elev]);
  });
  await writeCells(resolved);
  return results;
}

/**
 * Fetch elevation for a single point through the same cache levels.
 * Returns `null` on failure (offline / error / no result / aborted) — never a
 * fabricated 0.
 */
export async function getElevation(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const [elev] = await getElevations([{ lat, lon }], signal);
    return elev;
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.warn("[terrain] Elevation fetch failed:", err);
    }
    return null;
  }
}

/**
 * Download ground elevation over `bounds` into the persistent cache, so any
 * point inside resolves offline afterwards. Posts lie on the whole-arc-second
 * lattice nearest `spacingM` apart (north-south), snapped outward so the area
 * is fully enclosed; posts already stored are not fetched again.
 *
 * @returns `fetched`: posts now stored (including ones already present);
 *   `failed`: posts the API did not answer.
 * @throws RangeError for invalid bounds or an area over {@link MAX_PREFETCH_CELLS}
 *   posts; Error when this environment has no persistent storage;
 *   `AbortError` when `signal` aborts.
 */
export async function prefetchElevationGrid(
  bounds: { north: number; south: number; east: number; west: number },
  spacingM = 30,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ fetched: number; failed: number }> {
  const { north, south, east, west } = bounds;
  if (
    ![north, south, east, west, spacingM].every(Number.isFinite) ||
    north < south || east < west || spacingM <= 0
  ) {
    throw new RangeError("Invalid terrain download area");
  }
  const stride = Math.max(1, Math.round(spacingM / ARC_SECOND_M));
  const iS = postIndexBelow(south, stride);
  const jW = postIndexBelow(west, stride);
  // At least two posts per axis so every point inside has four corners.
  const rows = Math.max(postIndexAbove(north, stride), iS + 1) - iS + 1;
  const cols = Math.max(postIndexAbove(east, stride), jW + 1) - jW + 1;
  const total = rows * cols;
  if (total > MAX_PREFETCH_CELLS) throw new RangeError("Area too large for terrain download");
  if (!persistentCacheAvailable()) {
    throw new Error("Terrain download needs browser storage, which is unavailable here");
  }

  let fetched = 0;
  let failed = 0;
  onProgress?.(0, total);
  for (let start = 0; start < total; start += BATCH_CHUNK_SIZE) {
    signal?.throwIfAborted();
    const posts = Array.from({ length: Math.min(BATCH_CHUNK_SIZE, total - start) }, (_, n) => {
      const I = (iS + Math.floor((start + n) / cols)) * stride;
      const J = (jW + ((start + n) % cols)) * stride;
      return { lat: I * POST_DEG, lon: J * POST_DEG, key: postKey(I, J) };
    });
    const stored = await readCells(posts.map((p) => p.key));
    const missing = posts.filter((_, n) => stored[n] === undefined);
    const elevations = await fetchFromApi(missing, signal);
    const entries: Array<[string, number]> = [];
    missing.forEach((p, n) => {
      const elev = elevations[n];
      if (elev !== null) entries.push([p.key, elev]);
    });
    await writePosts(entries, stride);
    fetched += posts.length - missing.length + entries.length;
    failed += missing.length - entries.length;
    onProgress?.(start + posts.length, total);
  }
  return { fetched, failed };
}
