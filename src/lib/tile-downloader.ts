/**
 * Concurrent tile download engine.
 *
 * Downloads map tiles with configurable concurrency (default 6) into the
 * service worker's downloaded-areas cache, keyed the way the worker looks
 * them up, with abort support. Skips tiles already downloaded.
 *
 * @module tile-downloader
 * @license GPL-3.0-only
 */

import { TILE_CACHE_PINNED, isCacheableTileContentType, tileCacheKey } from "./tile-cache-key";

const DEFAULT_CONCURRENCY = 6;
/** Per-tile deadline covering the request and the body read. */
const TILE_FETCH_TIMEOUT_MS = 15_000;

export interface DownloadProgress {
  completed: number;
  total: number;
  bytes: number;
  skipped: number;
  failed: number;
}

export interface DownloadResult {
  completed: number;
  failed: number;
  skipped: number;
  totalBytes: number;
  /** Set when a tile could not be saved: the download stopped there. */
  storageError: string | null;
}

function storageErrorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === "QuotaExceededError") {
    return "Storage is full: the browser refused to save more tiles, so the download stopped. Free space or clear the tile cache, then download again.";
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `Tiles could not be saved to browser storage (${detail}), so the download stopped.`;
}

/**
 * Download tiles with concurrency control and progress reporting.
 * Skips tiles already in cache. Abortable via AbortSignal. URLs are pulled
 * from the iterable one at a time, so a large area is never materialised as
 * an array; `total` is the count the iterable yields, for progress.
 */
export async function downloadTiles(
  urls: Iterable<string>,
  total: number,
  onProgress: (progress: DownloadProgress) => void,
  options?: {
    concurrency?: number;
    signal?: AbortSignal;
  },
): Promise<DownloadResult> {
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  const signal = options?.signal;

  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let bytes = 0;
  let storageError: string | null = null;

  // Shared queue of remaining URLs; next() is synchronous, so workers never
  // take the same URL.
  const queue = urls[Symbol.iterator]();

  const report = () => {
    onProgress({ completed, total, bytes, skipped, failed });
  };

  if (typeof caches === "undefined") {
    return {
      completed: 0,
      failed: 0,
      skipped: 0,
      totalBytes: 0,
      storageError: storageErrorMessage(new Error("Cache Storage is unavailable on this page")),
    };
  }
  // Ask once that downloaded areas are not evicted under storage pressure.
  // The browser may refuse; the download goes ahead either way.
  navigator.storage?.persist?.().catch(() => {});
  let cache: Cache;
  try {
    cache = await caches.open(TILE_CACHE_PINNED);
  } catch (err) {
    return { completed: 0, failed: 0, skipped: 0, totalBytes: 0, storageError: storageErrorMessage(err) };
  }

  async function fetchOne(): Promise<void> {
    for (;;) {
      if (signal?.aborted || storageError) return;

      const next = queue.next();
      if (next.done) return;
      const url = next.value;
      const key = new Request(tileCacheKey(url));

      let blob: Blob;
      let contentType: string;
      try {
        if (await cache.match(key, { ignoreVary: true })) {
          skipped++;
          completed++;
          report();
          continue;
        }

        // Fetch tile. A stalled server connection counts as a failed tile
        // after the timeout instead of holding this worker forever.
        // `no-store` also tells the service worker not to keep a second,
        // browsing-cache copy of a tile this download stores itself.
        const timeout = AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS);
        const response = await fetch(url, {
          cache: "no-store",
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        contentType = response.headers.get("content-type") ?? "";
        // A 200 that is not a tile (a captive portal or an HTML error page)
        // is never stored, so it cannot poison later loads.
        if (!response.ok || !isCacheableTileContentType(contentType)) {
          failed++;
          completed++;
          report();
          continue;
        }
        blob = await response.blob();
      } catch {
        if (signal?.aborted) return;
        failed++;
        completed++;
        report();
        continue;
      }

      try {
        // The body is already decoded, so only its type is carried over.
        await cache.put(
          key,
          new Response(blob, { status: 200, headers: { "Content-Type": contentType } }),
        );
      } catch (err) {
        // A tile that is not stored is not available offline. Storage that
        // refused one write refuses the rest, so stop instead of reporting
        // tiles as downloaded that were never saved.
        storageError ??= storageErrorMessage(err);
        failed++;
        completed++;
        report();
        return;
      }

      bytes += blob.size;
      completed++;
      report();
    }
  }

  // Launch concurrent workers
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, () => fetchOne());
  await Promise.all(workers);

  return { completed: completed - failed - skipped, failed, skipped, totalBytes: bytes, storageError };
}
