/**
 * @module terrain/terrain-tile-cache
 * @description Persistent (IndexedDB) store of terrain tiles, bounded in size.
 *
 * Tiles are kept as their original PNG bytes under `"z/x/y"`. A second store
 * indexes every tile with when it was last used and whether an area download
 * pinned it. Once more than {@link MAX_STORED_TILES} tiles are stored, the
 * least recently used are removed (unpinned ones first) until
 * {@link TRIM_TO_TILES} remain, so the cache stays around 40 MB.
 *
 * Every IndexedDB failure (no IndexedDB at all during server rendering and
 * tests, storage blocked in a private window, a quota error) reads as a miss
 * and a skipped write, so the cache can only ever save a network call, never
 * fail a lookup.
 *
 * @license GPL-3.0-only
 */

import { createStore, delMany, entries, get, keys, set, type UseStore } from "idb-keyval";

/** Tiles kept before the least recently used are removed. */
export const MAX_STORED_TILES = 400;
/** Tiles left after a trim. */
const TRIM_TO_TILES = 350;

interface TileIndexEntry {
  usedAt: number;
  pinned: boolean;
}

let stores: { tiles: UseStore; index: UseStore } | null = null;
let warned = false;
/** Tiles stored, counted once from the index and then kept in step. */
let storedCount: number | null = null;

function tileStores(): { tiles: UseStore; index: UseStore } | null {
  if (globalThis.indexedDB == null) return null;
  if (stores === null) {
    stores = {
      tiles: createStore("ados-terrain-tiles", "tiles"),
      index: createStore("ados-terrain-index", "index"),
    };
  }
  return stores;
}

/** Whether tiles written here survive a reload. */
export function persistentCacheAvailable(): boolean {
  return tileStores() !== null;
}

function warnOnce(err: unknown): void {
  if (warned) return;
  warned = true;
  console.warn("[terrain] Persistent terrain tile cache unavailable:", err);
}

/** Stored PNG bytes of a tile, or `undefined`; a hit marks the tile used. */
export async function readTile(key: string): Promise<Uint8Array | undefined> {
  const s = tileStores();
  if (!s) return undefined;
  try {
    const bytes = await get<Uint8Array>(key, s.tiles);
    if (!(bytes instanceof Uint8Array)) return undefined;
    const entry = await get<TileIndexEntry>(key, s.index);
    await set(key, { usedAt: Date.now(), pinned: entry?.pinned === true }, s.index);
    return bytes;
  } catch (err) {
    warnOnce(err);
    return undefined;
  }
}

/** Whether a tile is stored. */
export async function hasTile(key: string): Promise<boolean> {
  const s = tileStores();
  if (!s) return false;
  try {
    return (await get(key, s.tiles)) instanceof Uint8Array;
  } catch (err) {
    warnOnce(err);
    return false;
  }
}

/**
 * Store a tile's PNG bytes. A pinned write pins the tile; an unpinned write
 * keeps an existing pin.
 */
export async function writeTile(key: string, bytes: Uint8Array, pinned: boolean): Promise<void> {
  const s = tileStores();
  if (!s) return;
  try {
    storedCount ??= (await keys(s.index)).length;
    const entry = await get<TileIndexEntry>(key, s.index);
    await set(key, bytes, s.tiles);
    await set(key, { usedAt: Date.now(), pinned: pinned || entry?.pinned === true }, s.index);
    if (entry === undefined) storedCount++;
    if (storedCount > MAX_STORED_TILES) await trim(s);
  } catch (err) {
    warnOnce(err);
  }
}

/** Remove least recently used tiles, unpinned first, down to {@link TRIM_TO_TILES}. */
async function trim(s: { tiles: UseStore; index: UseStore }): Promise<void> {
  const all = (await entries<string, TileIndexEntry>(s.index)).sort(
    ([, a], [, b]) => Number(a.pinned) - Number(b.pinned) || a.usedAt - b.usedAt,
  );
  const drop = all.slice(0, Math.max(0, all.length - TRIM_TO_TILES)).map(([k]) => k);
  await delMany(drop, s.tiles);
  await delMany(drop, s.index);
  storedCount = all.length - drop.length;
}
