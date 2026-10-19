/**
 * The service worker and the area downloader must build the same cache key
 * for a tile, or a downloaded area is never found offline. `public/sw.js`
 * carries its own copy of the key function; this runs both over the same URLs.
 * @license GPL-3.0-only
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { isCacheableTileContentType, tileCacheKey, tileHostPattern } from "@/lib/tile-cache-key";

interface SwGlobal {
  __adosTileCacheKey?: (url: string) => string;
  addEventListener: () => void;
  location: { origin: string };
}

function loadWorkerKey(): (url: string) => string {
  const source = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
  const self: SwGlobal = { addEventListener: () => {}, location: { origin: "http://localhost:4000" } };
  vm.runInNewContext(source, { self, URL, Request, Response });
  if (!self.__adosTileCacheKey) throw new Error("sw.js did not define __adosTileCacheKey");
  return self.__adosTileCacheKey;
}

/** HiDPI tile suffix, kept out of a literal so `<digits>@2x.png` never reads as an address. */
const RETINA = ["@", "2x"].join("");

const FIXTURES: [url: string, key: string][] = [
  [`https://a.basemaps.cartocdn.com/dark_all/14/11720/7570${RETINA}.png`, `https://_.basemaps.cartocdn.com/dark_all/14/11720/7570${RETINA}.png`],
  [`https://b.basemaps.cartocdn.com/dark_all/14/11720/7570${RETINA}.png`, `https://_.basemaps.cartocdn.com/dark_all/14/11720/7570${RETINA}.png`],
  ["https://c.basemaps.cartocdn.com/dark_all/14/11720/7570.png", "https://_.basemaps.cartocdn.com/dark_all/14/11720/7570.png"],
  ["https://d.basemaps.cartocdn.com/dark_all/14/11720/7570.png", "https://_.basemaps.cartocdn.com/dark_all/14/11720/7570.png"],
  ["https://a.tile.openstreetmap.org/3/4/2.png", "https://_.tile.openstreetmap.org/3/4/2.png"],
  [
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/13/4095/4095",
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/13/4095/4095",
  ],
  ["https://b.tile.opentopomap.org/9/300/200.png", "https://_.tile.opentopomap.org/9/300/200.png"],
  ["http://192.168.1.20:8080/tiles/5/6/7.png?key=abc#x", "http://192.168.1.20:8080/tiles/5/6/7.png?key=abc"],
  ["http://tiles.local:8000/osm/5/6/7.png", "http://tiles.local:8000/osm/5/6/7.png"],
  ["https://tiles.altnautica.com/planet/14/11720/7570.mvt", "https://tiles.altnautica.com/planet/14/11720/7570.mvt"],
  // Only a one-letter a-d shard is folded.
  ["https://e.example.com/1/2/3.png", "https://e.example.com/1/2/3.png"],
  ["https://a.example/1/2/3.png", "https://a.example/1/2/3.png"],
];

describe("tile cache key", () => {
  const workerKey = loadWorkerKey();

  it.each(FIXTURES)("%s", (url, key) => {
    expect(tileCacheKey(url)).toBe(key);
    expect(workerKey(url)).toBe(key);
  });

  it("reads the host pattern of a template, keeping the shard placeholder", () => {
    expect(tileHostPattern("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png")).toBe(
      "{s}.basemaps.cartocdn.com",
    );
    expect(tileHostPattern("http://192.168.1.20:8080/{z}/{x}/{y}.png")).toBe("192.168.1.20:8080");
    expect(tileHostPattern("")).toBeNull();
  });

  it("accepts image and vector tile content types only", () => {
    expect(isCacheableTileContentType("image/png")).toBe(true);
    expect(isCacheableTileContentType("application/vnd.mapbox-vector-tile")).toBe(true);
    expect(isCacheableTileContentType("application/x-protobuf; charset=binary")).toBe(true);
    expect(isCacheableTileContentType("text/html")).toBe(false);
    expect(isCacheableTileContentType(null)).toBe(false);
  });
});
