/**
 * Offline tile download: an area past the tile limit is refused before any URL
 * is generated, the downloader pulls URLs lazily from an iterable, tiles land
 * in the downloaded-areas cache under the shared tile key, and a tile the
 * browser refused to store is never reported as downloaded.
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { downloadTiles } from "@/lib/tile-downloader";
import { TILE_CACHE_PINNED } from "@/lib/tile-cache-key";
import { useTileDownloadStore, MAX_DOWNLOAD_TILES } from "@/stores/tile-download-store";
import { totalTileCount, type TileProvider } from "@/lib/tile-math";

const PROVIDER: TileProvider = {
  kind: "raster",
  url: "https://example.com/{z}/{x}/{y}.png", subdomains: [], maxZoom: 19, avgTileKB: 20,
  attribution: "", name: "Test", label: "TEST",
};

/** One fake cache: url → Response, with spy-able match/put. */
interface FakeCache {
  entries: Map<string, Response>;
  match: (req: Request) => Promise<Response | undefined>;
  put: (req: Request, res: Response) => Promise<void>;
}

const keyOf = (req: Request | string) => (typeof req === "string" ? req : req.url);

let opened: string[];
let stores: Map<string, FakeCache>;

function fakeCache(): FakeCache {
  const entries = new Map<string, Response>();
  return {
    entries,
    match: vi.fn(async (req: Request) => entries.get(keyOf(req))),
    put: vi.fn(async (req: Request, res: Response) => {
      entries.set(keyOf(req), res);
    }),
  };
}

function pinned(): FakeCache {
  let c = stores.get(TILE_CACHE_PINNED);
  if (!c) {
    c = fakeCache();
    stores.set(TILE_CACHE_PINNED, c);
  }
  return c;
}

const pngResponse = () =>
  new Response(new Blob(["x"]), { status: 200, headers: { "Content-Type": "image/png" } });

beforeEach(() => {
  useTileDownloadStore.setState({ isDownloading: false, result: null, error: null });
  opened = [];
  stores = new Map();
  vi.stubGlobal("caches", {
    open: vi.fn(async (name: string) => {
      opened.push(name);
      let c = stores.get(name);
      if (!c) {
        c = fakeCache();
        stores.set(name, c);
      }
      return c;
    }),
  });
  vi.stubGlobal("fetch", vi.fn(async () => pngResponse()));
});

describe("tile download", () => {
  it("refuses an area above the tile limit without fetching", async () => {
    const world = { north: 60, south: -60, east: 170, west: -170 };
    expect(totalTileCount(world, 1, 12)).toBeGreaterThan(MAX_DOWNLOAD_TILES);
    await useTileDownloadStore.getState().startDownload(world, 1, 12, PROVIDER);
    const s = useTileDownloadStore.getState();
    expect(s.isDownloading).toBe(false);
    expect(s.error).toMatch(/Too many tiles/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pulls every URL from the iterable exactly once", async () => {
    let pulled = 0;
    function* urls() {
      for (let i = 0; i < 25; i++) { pulled++; yield `https://example.com/${i}.png`; }
    }
    const result = await downloadTiles(urls(), 25, () => {}, { concurrency: 4 });
    expect(pulled).toBe(25);
    expect(fetch).toHaveBeenCalledTimes(25);
    expect(result).toMatchObject({ completed: 25, failed: 0, skipped: 0 });
  });

  it("stores tiles in the pinned cache under the shared key, skipping ones already there", async () => {
    const first = await downloadTiles(
      ["https://a.tiles.example.com/1/0/0.png", "https://b.tiles.example.com/1/0/1.png"],
      2,
      () => {},
    );
    expect(first).toMatchObject({ completed: 2, failed: 0, skipped: 0 });
    expect(opened).toEqual([TILE_CACHE_PINNED]);
    expect([...pinned().entries.keys()].sort()).toEqual([
      "https://_.tiles.example.com/1/0/0.png",
      "https://_.tiles.example.com/1/0/1.png",
    ]);
    expect(pinned().entries.get("https://_.tiles.example.com/1/0/0.png")?.headers.get("content-type")).toBe(
      "image/png",
    );
    // `no-store` keeps the service worker from holding a second copy.
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ cache: "no-store" });

    // Another shard of the same tile is a cache hit, not a second download.
    vi.mocked(fetch).mockClear();
    const again = await downloadTiles(["https://c.tiles.example.com/1/0/0.png"], 1, () => {});
    expect(again).toMatchObject({ completed: 0, failed: 0, skipped: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never stores a response that is not a tile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } })),
    );
    const result = await downloadTiles(["https://example.com/1/0/0.png"], 1, () => {});
    expect(result).toMatchObject({ completed: 0, failed: 1 });
    expect(pinned().entries.size).toBe(0);
  });

  it("stores vector tiles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "Content-Type": "application/vnd.mapbox-vector-tile" },
          }),
      ),
    );
    const result = await downloadTiles(["https://tiles.example.com/planet/3/1/2.mvt"], 1, () => {});
    expect(result).toMatchObject({ completed: 1, failed: 0, totalBytes: 3 });
  });

  it("reports unavailable storage instead of fetching when Cache Storage is missing", async () => {
    vi.stubGlobal("caches", undefined);
    const result = await downloadTiles(["https://example.com/1/0/0.png"], 1, () => {});
    expect(result.storageError).toMatch(/could not be saved/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("counts a stalled tile request as failed once its deadline passes", async () => {
    // The server never answers: the request settles only when its signal aborts.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );
    const expired = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      queueMicrotask(() => expired.abort(new DOMException("timeout", "TimeoutError")));
      return expired.signal;
    });

    // Without a deadline the worker waits on the stalled request forever.
    const result = await downloadTiles(["https://example.com/0.png"], 1, () => {});

    expect(result).toMatchObject({ completed: 0, failed: 1, skipped: 0 });
    vi.restoreAllMocks();
  }, 1000);

  it("stops and says storage is full when the cache refuses a write", async () => {
    vi.mocked(pinned().put).mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));
    const area = { north: 0.01, south: 0, east: 0.01, west: 0 };
    const total = totalTileCount(area, 1, 14);
    expect(total).toBeGreaterThan(1);

    await useTileDownloadStore.getState().startDownload(area, 1, 14, PROVIDER);

    const s = useTileDownloadStore.getState();
    expect(s.result?.failed).toBeGreaterThanOrEqual(1);
    expect(s.result?.storageError).toMatch(/Storage is full/);
    expect(s.error).toMatch(/Storage is full/);
    // Workers stop at the refusal: the tiles after it are never fetched.
    expect(s.result!.completed + s.result!.failed + s.result!.skipped).toBeLessThan(total);
  });
});
