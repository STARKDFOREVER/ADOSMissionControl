/**
 * @module tile-storage
 * @description Page-side view of the service worker's tile caches: entry
 * counts, browser storage usage, and clearing. The browsing cache fills as
 * the map is viewed; the downloaded-areas cache holds what the operator
 * downloaded and is never trimmed.
 * @license GPL-3.0-only
 */

import { TILE_CACHE_PINNED, TILE_CACHE_RUNTIME } from "./tile-cache-key";

export interface TileStorageStats {
  /** Tiles kept from browsing the map. */
  runtimeTiles: number;
  /** Tiles from downloaded areas. */
  pinnedTiles: number;
  /** Bytes this origin uses, all storage kinds; null when not reported. */
  usageBytes: number | null;
  /** Bytes this origin may use; null when not reported. */
  quotaBytes: number | null;
}

async function countEntries(name: string): Promise<number> {
  // `caches.has` first: `open` would create an empty cache as a side effect.
  if (!(await caches.has(name))) return 0;
  const cache = await caches.open(name);
  return (await cache.keys()).length;
}

/** Rejects when Cache Storage is unavailable (an insecure http origin). */
export async function getTileStorageStats(): Promise<TileStorageStats> {
  if (typeof caches === "undefined") {
    throw new Error("Cache Storage is unavailable on this page");
  }
  const [runtimeTiles, pinnedTiles, estimate] = await Promise.all([
    countEntries(TILE_CACHE_RUNTIME),
    countEntries(TILE_CACHE_PINNED),
    navigator.storage?.estimate?.().catch(() => undefined) ?? Promise.resolve(undefined),
  ]);
  return {
    runtimeTiles,
    pinnedTiles,
    usageBytes: estimate?.usage ?? null,
    quotaBytes: estimate?.quota ?? null,
  };
}

/** Free bytes left in this origin's quota, or null when not reported. */
export async function freeTileStorageBytes(): Promise<number | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return quota === undefined || usage === undefined ? null : Math.max(0, quota - usage);
  } catch {
    return null;
  }
}

/** Drop the browsing cache (`"runtime"`) or every downloaded area (`"pinned"`). */
export async function clearTileCache(which: "runtime" | "pinned"): Promise<void> {
  if (typeof caches === "undefined") return;
  await caches.delete(which === "runtime" ? TILE_CACHE_RUNTIME : TILE_CACHE_PINNED);
}
