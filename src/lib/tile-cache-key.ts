/**
 * @module tile-cache-key
 * @description One cache key per map tile, shared by the service worker
 * (`public/sw.js`) and the offline area downloader. Tile CDNs spread one tile
 * across `a.`/`b.`/`c.`/`d.` subdomains, so the subdomain label is folded to
 * `_`: the same tile fetched from any shard hits the same cache entry.
 *
 * `tileCacheKey` is copied verbatim into `public/sw.js` as
 * `self.__adosTileCacheKey`; `tests/unit/tile-cache-key.test.ts` runs both
 * over the same URLs and fails when they drift.
 * @license GPL-3.0-only
 */

/** Cache names the service worker owns. The downloader writes `pinned`. */
export const TILE_CACHE_RUNTIME = "ados-tiles-runtime-v1";
export const TILE_CACHE_PINNED = "ados-tiles-pinned-v1";

/** Response types a tile cache may store: images and vector tiles. */
export function isCacheableTileContentType(contentType: string | null): boolean {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return (
    ct.startsWith("image/") ||
    ct === "application/x-protobuf" ||
    ct === "application/vnd.mapbox-vector-tile" ||
    ct === "application/octet-stream"
  );
}

/**
 * Host pattern of a tile URL template, as the service worker matches it:
 * `{s}.basemaps.cartocdn.com` for a sharded template, `host:port` otherwise.
 * Null for a template that is not an http(s) URL.
 */
export function tileHostPattern(urlTemplate: string): string | null {
  const m = /^https?:\/\/([^/?#]+)/i.exec(urlTemplate.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Cache key for a tile URL: the URL with a one-letter `a`-`d` shard label
 * folded to `_` and any fragment dropped. Path and query are kept, so `@2x`
 * and a `.mvt`/`.png` extension stay distinct entries.
 */
export function tileCacheKey(url: string): string {
  const u = new URL(url);
  const labels = u.hostname.split(".");
  if (labels.length > 2 && /^[a-d]$/.test(labels[0])) {
    labels[0] = "_";
    u.hostname = labels.join(".");
  }
  u.hash = "";
  return u.toString();
}
