/**
 * @module terrain/elevation-cache
 * @description Persistent (IndexedDB) second level of the elevation cache.
 *
 * Two kinds of entry share one object store:
 *
 * - **Cells**: an elevation the API returned for an exact point, keyed by the
 *   same quantised cell key the in-memory LRU uses. A reload asking for the
 *   same point gets it without a network call.
 * - **Posts**: a lattice on whole arc-seconds (the posting of the SRTM-class
 *   DEM the API serves), filled by an area download. Any point inside a
 *   downloaded area resolves by bilinear interpolation between its four
 *   surrounding posts, so terrain works offline for points never queried
 *   before. An area downloaded at a coarser spacing uses every k-th post; the
 *   strides in use are recorded so a lookup knows which posts to read.
 *
 * Only real elevations are written; a failed lookup is never stored. Every
 * IndexedDB failure (no IndexedDB at all during server rendering and tests,
 * storage blocked in a private window, a quota error) reads as a miss and a
 * skipped write, so the cache can only ever save a network call, never fail
 * a lookup.
 *
 * @license GPL-3.0-only
 */

import { createStore, getMany, get, set, setMany, type UseStore } from "idb-keyval";

const DB_NAME = "ados-elevation";
const STORE_NAME = "cells";
const STRIDES_KEY = "meta:strides";

/** Lattice post spacing, degrees: one arc-second (~31 m north-south). */
export const POST_DEG = 1 / 3600;

let store: UseStore | null = null;
let warned = false;
/** Lattice strides (in arc-seconds) that downloaded areas used; loaded lazily. */
let strides: number[] | null = null;

function elevationStore(): UseStore | null {
  if (globalThis.indexedDB == null) return null;
  if (store === null) store = createStore(DB_NAME, STORE_NAME);
  return store;
}

/** Whether elevations written here survive a reload. */
export function persistentCacheAvailable(): boolean {
  return elevationStore() !== null;
}

function warnOnce(err: unknown): void {
  if (warned) return;
  warned = true;
  console.warn("[terrain] Persistent elevation cache unavailable:", err);
}

function isElevation(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Read stored cell elevations; `undefined` at every key not stored. */
export async function readCells(keys: string[]): Promise<Array<number | undefined>> {
  const s = elevationStore();
  if (!s || keys.length === 0) return keys.map(() => undefined);
  try {
    const values = await getMany<unknown>(keys, s);
    return values.map((v) => (isElevation(v) ? v : undefined));
  } catch (err) {
    warnOnce(err);
    return keys.map(() => undefined);
  }
}

/** Store resolved cell elevations. Non-finite values are dropped, never stored. */
export async function writeCells(entries: Array<[string, number]>): Promise<void> {
  const s = elevationStore();
  const valid = entries.filter(([, v]) => isElevation(v));
  if (!s || valid.length === 0) return;
  try {
    await setMany(valid, s);
  } catch (err) {
    warnOnce(err);
  }
}

/** Key of the lattice post at global arc-second indices (`i` north, `j` east). */
export function postKey(i: number, j: number): string {
  return `p:${i}:${j}`;
}

async function loadStrides(s: UseStore): Promise<number[]> {
  if (strides !== null) return strides;
  try {
    const stored = await get<unknown>(STRIDES_KEY, s);
    strides = Array.isArray(stored)
      ? stored.filter((k): k is number => Number.isInteger(k) && k >= 1).sort((a, b) => a - b)
      : [];
  } catch (err) {
    warnOnce(err);
    strides = [];
  }
  return strides;
}

/**
 * Store downloaded lattice posts and record the stride they were laid at, so
 * later lookups interpolate from them.
 */
export async function writePosts(entries: Array<[string, number]>, stride: number): Promise<void> {
  const s = elevationStore();
  if (!s) return;
  await writeCells(entries);
  const known = await loadStrides(s);
  if (known.includes(stride)) return;
  strides = [...known, stride].sort((a, b) => a - b);
  try {
    await set(STRIDES_KEY, strides, s);
  } catch (err) {
    warnOnce(err);
  }
}

interface Corners {
  keys: [string, string, string, string];
  fi: number;
  fj: number;
}

/**
 * Floating-point slack when snapping a coordinate to the post lattice, so a
 * point sitting exactly on a post is not assigned to the cell below it.
 */
const POST_EPS = 1e-9;

/** Index (in strides of `k` arc-seconds) of the lattice line at or below `deg`. */
export function postIndexBelow(deg: number, k: number): number {
  return Math.floor(deg / POST_DEG / k + POST_EPS);
}

/** Index (in strides of `k` arc-seconds) of the lattice line at or above `deg`. */
export function postIndexAbove(deg: number, k: number): number {
  return Math.ceil(deg / POST_DEG / k - POST_EPS);
}

function cornersFor(lat: number, lon: number, k: number): Corners {
  const i0 = postIndexBelow(lat, k);
  const j0 = postIndexBelow(lon, k);
  const I = i0 * k;
  const J = j0 * k;
  return {
    keys: [postKey(I, J), postKey(I, J + k), postKey(I + k, J), postKey(I + k, J + k)],
    fi: Math.max(0, lat / POST_DEG / k - i0),
    fj: Math.max(0, lon / POST_DEG / k - j0),
  };
}

/**
 * Elevation at each point interpolated from downloaded lattice posts, or
 * `undefined` where the four surrounding posts are not all stored. Finer
 * strides are tried first.
 */
export async function interpolateFromPosts(
  points: Array<{ lat: number; lon: number }>,
): Promise<Array<number | undefined>> {
  const out = new Array<number | undefined>(points.length).fill(undefined);
  const s = elevationStore();
  if (!s || points.length === 0) return out;
  const known = await loadStrides(s);
  for (const k of known) {
    const pending = out.flatMap((v, idx) => (v === undefined ? [idx] : []));
    if (pending.length === 0) break;
    const corners = pending.map((idx) => cornersFor(points[idx].lat, points[idx].lon, k));
    const values = await readCells(corners.flatMap((c) => c.keys));
    pending.forEach((idx, n) => {
      const [sw, se, nw, ne] = values.slice(n * 4, n * 4 + 4);
      if (sw === undefined || se === undefined || nw === undefined || ne === undefined) return;
      const { fi, fj } = corners[n];
      const south = sw + (se - sw) * fj;
      const north = nw + (ne - nw) * fj;
      out[idx] = south + (north - south) * fi;
    });
  }
  return out;
}
