/**
 * @module terrain/terrain-provider
 * @description Ground elevation from the open terrain tiles (Mapzen Terrain
 * Tiles on AWS Open Data, "terrarium" encoding, zoom {@link TERRAIN_ZOOM}).
 *
 * Heights are metres above mean sea level (orthometric: SRTM on EGM96, 3DEP
 * and similar sources), the datum every planner altitude check uses. A point
 * resolves by bilinear interpolation between the four surrounding pixel
 * centres, loading the neighbouring tile when a point sits near a tile edge.
 *
 * Tiles resolve in three levels: decoded tiles in memory (64, least recently
 * used dropped), then the persistent tile cache (`terrain-tile-cache.ts`,
 * bounded, pinned tiles from area downloads kept longest), then the network.
 * Every caller asking for one tile shares one load. A tile that failed to load
 * (offline, not found, undecodable) is remembered for a minute, so repeated
 * edits do not refetch it, and then tried again.
 *
 * Returns `null` for a point whose ground is unknown. That is the whole
 * contract: a genuine sea-level 0 m reading and "we have no idea" are
 * different facts, and a mission validated against a fabricated 0 m ground is
 * the worst kind of false green. `null` (rather than `NaN`) makes the unknown
 * case a compile-time obligation for every caller.
 *
 * @license GPL-3.0-only
 */

import { TERRAIN_ZOOM, TILE_SIZE, decodeTerrariumPng, tileUrl, worldPixel } from "./terrarium";
import { hasTile, persistentCacheAvailable, readTile, writeTile } from "./terrain-tile-cache";

/** Decoded tiles kept in memory (about 256 KB each). */
const MEMORY_TILES = 64;
/** How long a failed tile is answered as unknown without a new request, ms. */
const FAILURE_HOLD_MS = 60_000;
/** Below this a tile pixel is a no-data fill, not real ground. */
const NO_DATA_BELOW_M = -11_000;

/** Largest area download, in tiles. */
export const MAX_PREFETCH_TILES = 64;

// LRU: Map preserves insertion order, oldest entries are first.
const memory = new Map<string, Float32Array>();
/** Failed tile key → time the failure expires. */
const failures = new Map<string, number>();
const inFlight = new Map<string, Promise<Float32Array | null>>();

function remember(key: string, tile: Float32Array): void {
  memory.delete(key);
  memory.set(key, tile);
  if (memory.size > MEMORY_TILES) memory.delete(memory.keys().next().value as string);
}

/** Decode stored bytes; `null` when they no longer decode. */
function decodeOrNull(bytes: Uint8Array): Float32Array | null {
  try {
    return decodeTerrariumPng(bytes);
  } catch {
    return null;
  }
}

/** Fetch one tile's PNG bytes and decoded heights; `null` on any failure. */
async function fetchTile(
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; tile: Float32Array } | null> {
  try {
    const res = await fetch(tileUrl(z, x, y), signal ? { signal } : undefined);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const tile = decodeOrNull(bytes);
    return tile ? { bytes, tile } : null;
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
}

async function loadUncached(z: number, x: number, y: number, key: string): Promise<Float32Array | null> {
  const stored = await readTile(key);
  const decoded = stored ? decodeOrNull(stored) : null;
  if (decoded) {
    remember(key, decoded);
    return decoded;
  }
  const fetched = await fetchTile(z, x, y);
  if (!fetched) {
    failures.set(key, Date.now() + FAILURE_HOLD_MS);
    return null;
  }
  remember(key, fetched.tile);
  await writeTile(key, fetched.bytes, false);
  return fetched.tile;
}

/** One tile's decoded heights, shared by every caller; `null` when unavailable. */
function loadTile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;
  const hit = memory.get(key);
  if (hit) {
    remember(key, hit);
    return Promise.resolve(hit);
  }
  const failedUntil = failures.get(key);
  if (failedUntil !== undefined) {
    if (Date.now() < failedUntil) return Promise.resolve(null);
    failures.delete(key);
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const load = loadUncached(z, x, y, key).finally(() => inFlight.delete(key));
  inFlight.set(key, load);
  return load;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/** Wait for `work`, rejecting with `AbortError` as soon as `signal` aborts. */
function raceAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** A sampled pixel: tile key, tile address and index inside the tile. */
interface Corner {
  key: string;
  x: number;
  y: number;
  index: number;
}

/**
 * Elevations for many points, in order; `null` wherever the ground is
 * unknown. Rejects with `AbortError` when `signal` aborts (the tile loads
 * other callers share carry on).
 */
export async function getElevations(
  points: Array<{ lat: number; lon: number }>,
  signal?: AbortSignal,
): Promise<Array<number | null>> {
  if (points.length === 0) return [];
  const z = TERRAIN_ZOOM;
  const tiles = 2 ** z;
  const size = tiles * TILE_SIZE;

  const corner = (gx: number, gy: number): Corner => {
    const px = ((gx % size) + size) % size;
    const py = Math.max(0, Math.min(size - 1, gy));
    const x = Math.floor(px / TILE_SIZE);
    const y = Math.floor(py / TILE_SIZE);
    return { key: `${z}/${x}/${y}`, x, y, index: (py % TILE_SIZE) * TILE_SIZE + (px % TILE_SIZE) };
  };

  const samples = points.map(({ lat, lon }) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const p = worldPixel(lat, lon, z);
    const fx = p.x - 0.5;
    const fy = p.y - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    return {
      tx: fx - x0,
      ty: fy - y0,
      corners: [corner(x0, y0), corner(x0 + 1, y0), corner(x0, y0 + 1), corner(x0 + 1, y0 + 1)],
    };
  });

  const wanted = new Map<string, Corner>();
  for (const s of samples) for (const c of s?.corners ?? []) wanted.set(c.key, c);
  const keys = [...wanted.keys()];
  const loaded = await raceAbort(
    Promise.all(keys.map((k) => loadTile(z, wanted.get(k)!.x, wanted.get(k)!.y))),
    signal,
  );
  const byKey = new Map(keys.map((k, i) => [k, loaded[i]]));

  return samples.map((s) => {
    if (!s) return null;
    const values: number[] = [];
    for (const c of s.corners) {
      const v = byKey.get(c.key)?.[c.index];
      if (v === undefined || v < NO_DATA_BELOW_M) return null;
      values.push(v);
    }
    const [nw, ne, sw, se] = values;
    const north = nw + (ne - nw) * s.tx;
    const south = sw + (se - sw) * s.tx;
    return north + (south - north) * s.ty;
  });
}

/**
 * Elevation of one point. Returns `null` on failure (offline / error / no
 * data / aborted), never a fabricated 0.
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
 * Download the terrain tiles covering `bounds` into the persistent cache and
 * pin them, so every point inside resolves offline afterwards. Tiles already
 * stored are pinned without a new request.
 *
 * @returns `fetched`: tiles now stored (including ones already present);
 *   `failed`: tiles that could not be downloaded.
 * @throws RangeError for invalid bounds or an area over {@link MAX_PREFETCH_TILES}
 *   tiles; Error when this environment has no persistent storage;
 *   `AbortError` when `signal` aborts.
 */
export async function prefetchElevationGrid(
  bounds: { north: number; south: number; east: number; west: number },
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ fetched: number; failed: number }> {
  const { north, south, east, west } = bounds;
  if (![north, south, east, west].every(Number.isFinite) || north < south || east < west) {
    throw new RangeError("Invalid terrain download area");
  }
  const z = TERRAIN_ZOOM;
  const last = 2 ** z - 1;
  const nw = worldPixel(north, west, z);
  const se = worldPixel(south, east, z);
  const tileOf = (v: number) => Math.max(0, Math.min(last, Math.floor(v / TILE_SIZE)));
  const [x0, x1, y0, y1] = [tileOf(nw.x), tileOf(se.x), tileOf(nw.y), tileOf(se.y)];
  const cols = x1 - x0 + 1;
  const total = cols * (y1 - y0 + 1);
  if (total > MAX_PREFETCH_TILES) throw new RangeError("Area too large for terrain download");
  if (!persistentCacheAvailable()) {
    throw new Error("Terrain download needs browser storage, which is unavailable here");
  }

  let fetched = 0;
  let failed = 0;
  onProgress?.(0, total);
  for (let i = 0; i < total; i++) {
    signal?.throwIfAborted();
    const x = x0 + (i % cols);
    const y = y0 + Math.floor(i / cols);
    const key = `${z}/${x}/${y}`;
    const stored = (await hasTile(key)) ? await readTile(key) : undefined;
    if (stored) {
      await writeTile(key, stored, true);
      fetched++;
    } else {
      const result = await fetchTile(z, x, y, signal);
      if (result) {
        await writeTile(key, result.bytes, true);
        remember(key, result.tile);
        failures.delete(key);
        fetched++;
      } else {
        failed++;
      }
    }
    onProgress?.(i + 1, total);
  }
  return { fetched, failed };
}
