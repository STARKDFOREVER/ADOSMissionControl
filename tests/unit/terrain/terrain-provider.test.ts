/**
 * Ground heights from terrain tiles: values interpolate between pixel
 * centres, callers share one load per tile, edge points read the neighbour
 * tile, failures are held for a minute, stored tiles answer after a reload,
 * and aborting one caller leaves the others' load running.
 * @license GPL-3.0-only
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type * as ProviderModule from '@/lib/terrain/terrain-provider';
import { encodeTerrariumPng, latLonOfPixel } from '../../helpers/terrarium-png';

const idb = vi.hoisted(() => ({ stores: new Map<string, Map<string, unknown>>() }));
vi.mock('idb-keyval', async () => {
  // vi.mock factories are hoisted above static imports.
  const { createIdbMock } = await import('../../helpers/terrarium-png');
  return createIdbMock(idb.stores);
});

const Z = 13;
const TX = 1544;
const TY = 3215;
/** Pixel (col, row) of every tile holds 1000 + col + 2 × row metres. */
const TILE = encodeTerrariumPng((col, row) => 1000 + col + 2 * row);
const valueAt = (col: number, row: number) => 1000 + col + 2 * row;

const mockFetch = vi.fn();

function serveTiles() {
  mockFetch.mockImplementation(async () => new Response(TILE.slice(), { status: 200 }));
}

/** The point at global pixel coordinates inside tile (TX, TY). */
function at(col: number, row: number) {
  return latLonOfPixel(TX * 256 + col, TY * 256 + row, Z);
}

/** A fresh module instance: memory is empty, IndexedDB is kept (hence the dynamic import). */
async function reload(): Promise<typeof ProviderModule> {
  vi.resetModules();
  return import('@/lib/terrain/terrain-provider');
}

let provider: typeof ProviderModule;

beforeEach(async () => {
  idb.stores.clear();
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  vi.stubGlobal('indexedDB', {});
  provider = await reload();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getElevations', () => {
  it('returns the encoded value at a pixel centre', async () => {
    serveTiles();
    const [h] = await provider.getElevations([at(100.5, 50.5)]);
    expect(h).toBeCloseTo(valueAt(100, 50), 3);
    expect(mockFetch).toHaveBeenCalledWith(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${TX}/${TY}.png`, undefined);
  });

  it('interpolates midway between two pixel centres', async () => {
    serveTiles();
    const [h] = await provider.getElevations([at(101, 50.5)]);
    expect(h).toBeCloseTo((valueAt(100, 50) + valueAt(101, 50)) / 2, 3);
  });

  it('keeps order and length, with null for an unusable point', async () => {
    serveTiles();
    const result = await provider.getElevations([at(10.5, 10.5), { lat: Number.NaN, lon: 0 }, at(20.5, 10.5)]);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(valueAt(10, 10), 3);
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(valueAt(20, 10), 3);
  });

  it('shares one fetch between concurrent callers in one tile', async () => {
    serveTiles();
    const [a, b] = await Promise.all([
      provider.getElevations([at(10.5, 10.5)]),
      provider.getElevations([at(200.5, 100.5), at(30.5, 30.5)]),
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(a[0]).toBeCloseTo(valueAt(10, 10), 3);
    expect(b[0]).toBeCloseTo(valueAt(200, 100), 3);
  });

  it('loads the neighbour tile for a point on a tile edge', async () => {
    serveTiles();
    const [h] = await provider.getElevations([at(256, 100.5)]);
    const urls = mockFetch.mock.calls.map(([url]) => url as string);
    expect(urls.some((u) => u.endsWith(`/${TX}/${TY}.png`))).toBe(true);
    expect(urls.some((u) => u.endsWith(`/${TX + 1}/${TY}.png`))).toBe(true);
    // Midway between pixel 255 of this tile and pixel 0 of the next.
    expect(h).toBeCloseTo((valueAt(255, 100) + valueAt(0, 100)) / 2, 3);
  });

  it('answers null for a missing tile and holds the failure for a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mockFetch.mockResolvedValue(new Response('missing', { status: 404 }));
    expect(await provider.getElevation(at(10.5, 10.5).lat, at(10.5, 10.5).lon)).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    expect(await provider.getElevations([at(10.5, 10.5)])).toEqual([null]);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 60_001);
    serveTiles();
    const [h] = await provider.getElevations([at(10.5, 10.5)]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(h).toBeCloseTo(valueAt(10, 10), 3);
  });

  it('answers null on a network error', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await provider.getElevations([at(10.5, 10.5)])).toEqual([null]);
  });

  it('answers from stored tiles after a reload without a request', async () => {
    serveTiles();
    await provider.getElevations([at(10.5, 10.5)]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fresh = await reload();
    const [h] = await fresh.getElevations([at(40.5, 60.5)]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(h).toBeCloseTo(valueAt(40, 60), 3);
  });

  it('rejects an aborted caller while another caller sharing the tile resolves', async () => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    mockFetch.mockReturnValue(promise);
    const controller = new AbortController();
    const aborted = provider.getElevations([at(10.5, 10.5)], controller.signal);
    const kept = provider.getElevations([at(20.5, 10.5)]);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    resolve(new Response(TILE.slice(), { status: 200 }));
    const [h] = await kept;
    expect(h).toBeCloseTo(valueAt(20, 10), 3);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('getElevation returns null without a warning when aborted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const controller = new AbortController();
    controller.abort();
    expect(await provider.getElevation(at(10.5, 10.5).lat, at(10.5, 10.5).lon, controller.signal)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('prefetchElevationGrid', () => {
  /** Bounds spanning tiles TX..TX+1 by TY..TY+1. */
  const nw = latLonOfPixel(TX * 256 + 200, TY * 256 + 200, Z);
  const se = latLonOfPixel((TX + 1) * 256 + 50, (TY + 1) * 256 + 50, Z);
  const bounds = { north: nw.lat, south: se.lat, west: nw.lon, east: se.lon };

  it('refuses an area over the tile limit before any request', async () => {
    await expect(
      provider.prefetchElevationGrid({ south: 12, north: 13, west: 77, east: 78 }),
    ).rejects.toThrow(new RangeError('Area too large for terrain download'));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('stores and pins every tile, and a repeat makes no request', async () => {
    serveTiles();
    const progress: Array<[number, number]> = [];
    const result = await provider.prefetchElevationGrid(bounds, (done, total) => progress.push([done, total]));
    expect(progress).toEqual([[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]);
    expect(result).toEqual({ fetched: 4, failed: 0 });
    expect(idb.stores.get('tiles')?.size).toBe(4);
    const index = [...(idb.stores.get('index')?.values() ?? [])] as Array<{ pinned: boolean }>;
    expect(index.map((e) => e.pinned)).toEqual([true, true, true, true]);

    const again = await provider.prefetchElevationGrid(bounds);
    expect(again).toEqual({ fetched: 4, failed: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('counts tiles that could not be downloaded', async () => {
    mockFetch.mockResolvedValue(new Response('missing', { status: 404 }));
    expect(await provider.prefetchElevationGrid(bounds)).toEqual({ fetched: 0, failed: 4 });
    expect(idb.stores.get('tiles')?.size ?? 0).toBe(0);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(provider.prefetchElevationGrid(bounds, undefined, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('needs browser storage', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const fresh = await reload();
    await expect(fresh.prefetchElevationGrid(bounds)).rejects.toThrow(/browser storage/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
