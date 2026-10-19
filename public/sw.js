/**
 * ADOS Mission Control service worker.
 *
 * Map tiles: every GET to a configured tile host whose path ends in z/x/y is
 * answered from the downloaded-areas cache, then the browsing cache, then the
 * network. Readable image and vector-tile responses are kept in the browsing
 * cache, which is trimmed oldest-first. Tile hosts come from the page
 * (`{type: "config", tileHosts}`) and are stored so they survive a restart.
 *
 * App shell: build assets and basemap fonts/sprites are cache-first, page
 * navigations are network-first with the cached document as the offline
 * fallback. Everything else passes through untouched.
 *
 * @license GPL-3.0-only
 */

const RUNTIME_CACHE = "ados-tiles-runtime-v1";
const PINNED_CACHE = "ados-tiles-pinned-v1";
const SHELL_CACHE = "ados-shell-v1";
const CURRENT_CACHES = [RUNTIME_CACHE, PINNED_CACHE, SHELL_CACHE];
const CONFIG_KEY = "/__ados_sw_config";
const RUNTIME_MAX_ENTRIES = 20000;
const TRIM_INTERVAL_MS = 30000;
const TILE_PATH = /\/\d+\/\d+\/\d+(@2x)?(\.\w+)?$/;

// Kept identical to `tileCacheKey` in src/lib/tile-cache-key.ts; a unit test
// runs both over the same URLs.
self.__adosTileCacheKey = function tileCacheKey(url) {
  const u = new URL(url);
  const labels = u.hostname.split(".");
  if (labels.length > 2 && /^[a-d]$/.test(labels[0])) {
    labels[0] = "_";
    u.hostname = labels.join(".");
  }
  u.hash = "";
  return u.toString();
};

function isCacheableTileResponse(response) {
  if (!response || !response.ok) return false;
  if (response.type !== "cors" && response.type !== "basic") return false;
  const ct = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  return (
    ct.startsWith("image/") ||
    ct === "application/x-protobuf" ||
    ct === "application/vnd.mapbox-vector-tile" ||
    ct === "application/octet-stream"
  );
}

// ── Tile host config ────────────────────────────────────────

/** Compiled host matchers, or null until the stored config is read. */
let hostMatchers = null;
let configLoad = null;

function compileHosts(hosts) {
  return (Array.isArray(hosts) ? hosts : [])
    .filter((h) => typeof h === "string" && h.length > 0)
    .map((h) => {
      const escaped = h.toLowerCase().replace(/[.*+?^$()|[\]\\]/g, "\\$&");
      return new RegExp("^" + escaped.replace(/\{s\}/g, "[a-z0-9-]+") + "$");
    });
}

function loadConfig() {
  if (hostMatchers) return Promise.resolve(hostMatchers);
  if (!configLoad) {
    configLoad = caches
      .open(SHELL_CACHE)
      .then((cache) => cache.match(CONFIG_KEY))
      .then((res) => (res ? res.json() : { tileHosts: [] }))
      .catch(() => ({ tileHosts: [] }))
      .then((cfg) => {
        // A config posted while this read was in flight wins.
        if (!hostMatchers) hostMatchers = compileHosts(cfg.tileHosts);
        return hostMatchers;
      });
  }
  return configLoad;
}

function isTileRequest(request, url, matchers) {
  if (request.method !== "GET" || !TILE_PATH.test(url.pathname)) return false;
  const host = url.host.toLowerCase();
  return matchers.some((re) => re.test(host));
}

// ── Tile cache ──────────────────────────────────────────────

let lastTrimAt = 0;
let trimming = false;

async function trimRuntime() {
  const cache = await caches.open(RUNTIME_CACHE);
  const keys = await cache.keys();
  const excess = keys.length - RUNTIME_MAX_ENTRIES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

function maybeTrim() {
  const now = Date.now();
  if (trimming || now - lastTrimAt < TRIM_INTERVAL_MS) return Promise.resolve();
  lastTrimAt = now;
  trimming = true;
  return trimRuntime()
    .catch(() => {})
    .finally(() => {
      trimming = false;
    });
}

async function handleTile(event) {
  const request = event.request;
  const key = new Request(self.__adosTileCacheKey(request.url));
  const pinned = await caches.open(PINNED_CACHE);
  const pinnedHit = await pinned.match(key, { ignoreVary: true });
  if (pinnedHit) return pinnedHit;
  const runtime = await caches.open(RUNTIME_CACHE);
  const runtimeHit = await runtime.match(key, { ignoreVary: true });
  if (runtimeHit) return runtimeHit;

  const response = await fetch(request);
  // The area downloader fetches with `no-store` and writes its own pinned
  // copy; storing it here too would hold every downloaded tile twice.
  if (request.cache !== "no-store" && isCacheableTileResponse(response)) {
    event.waitUntil(
      runtime
        .put(key, response.clone())
        .then(maybeTrim)
        .catch(() => {}),
    );
  }
  return response;
}

// ── App shell ───────────────────────────────────────────────

async function cacheFirst(event) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (response.ok && response.type === "basic") {
    event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
  }
  return response;
}

async function networkFirstDocument(event) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(event.request);
    if (response.ok && response.type === "basic") {
      event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
    }
    return response;
  } catch (err) {
    const hit =
      (await cache.match(event.request)) ||
      (await cache.match(event.request, { ignoreSearch: true }));
    if (hit) return hit;
    throw err;
  }
}

// ── Lifecycle ───────────────────────────────────────────────

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n.startsWith("ados-") && !CURRENT_CACHES.includes(n))
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "config") return;
  const tileHosts = Array.isArray(data.tileHosts) ? data.tileHosts : [];
  hostMatchers = compileHosts(tileHosts);
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        cache.put(
          CONFIG_KEY,
          new Response(JSON.stringify({ tileHosts }), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      )
      .catch(() => {}),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/basemap-assets/")) {
      event.respondWith(cacheFirst(event));
      return;
    }
    if (request.mode === "navigate") {
      event.respondWith(networkFirstDocument(event));
      return;
    }
  }

  if (!TILE_PATH.test(url.pathname)) return;
  if (hostMatchers) {
    if (isTileRequest(request, url, hostMatchers)) event.respondWith(handleTile(event));
    return;
  }
  // Restarted worker: the host list is still being read back from storage.
  event.respondWith(
    loadConfig().then((matchers) =>
      isTileRequest(request, url, matchers) ? handleTile(event) : fetch(request),
    ),
  );
});
