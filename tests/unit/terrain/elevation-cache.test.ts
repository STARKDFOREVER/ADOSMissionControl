/**
 * Persistent elevation cache: lookups survive a reload without a network
 * call, failures are never remembered, and an area download answers points
 * inside it offline.
 * @license GPL-3.0-only
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as ProviderModule from '@/lib/terrain/terrain-provider';

const idb = vi.hoisted(() => ({ cells: new Map<string, unknown>() }));
vi.mock('idb-keyval', () => ({
  createStore: () => () => Promise.resolve(),
  get: async (k: string) => idb.cells.get(k),
  getMany: async (keys: string[]) => keys.map((k) => idb.cells.get(k)),
  set: async (k: string, v: unknown) => {
    idb.cells.set(k, v);
  },
  setMany: async (entries: Array<[string, unknown]>) => {
    for (const [k, v] of entries) idb.cells.set(k, v);
  },
}));

type Provider = typeof ProviderModule;

const mockFetch = vi.fn();

/** Answer every requested location with `elevationAt(lat, lon)`. */
function answerWith(elevationAt: (lat: number, lon: number) => number) {
  mockFetch.mockImplementation(async (_url: string, init: { body: string }) => {
    const { locations } = JSON.parse(init.body) as {
      locations: Array<{ latitude: number; longitude: number }>;
    };
    return {
      ok: true,
      json: async () => ({
        results: locations.map((l) => ({ elevation: elevationAt(l.latitude, l.longitude) })),
      }),
    };
  });
}

/** A fresh module instance: the in-memory LRU is empty, IndexedDB is kept. */
async function reload(): Promise<Provider> {
  vi.resetModules();
  return import('@/lib/terrain/terrain-provider');
}

beforeEach(() => {
  idb.cells.clear();
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  vi.stubGlobal('indexedDB', {});
});

describe('persistent elevation cache', () => {
  it('answers a lookup after a reload from IndexedDB without a second API call', async () => {
    answerWith(() => 912);
    const first = await reload();
    expect(await first.getElevation(12.9716, 77.5946)).toBe(912);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const second = await reload();
    expect(await second.getElevation(12.9716, 77.5946)).toBe(912);
    expect(await second.getElevations([{ lat: 12.9716, lon: 77.5946 }])).toEqual([912]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('never stores a failed lookup, so it is retried after a reload', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = await reload();
    expect(await first.getElevation(13.1, 77.6)).toBeNull();
    expect(idb.cells.size).toBe(0);

    answerWith(() => 640);
    const second = await reload();
    expect(await second.getElevation(13.1, 77.6)).toBe(640);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('stores only the points a partial answer resolved', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ elevation: 300 }, {}] }),
    });
    const provider = await reload();
    expect(
      await provider.getElevations([
        { lat: 14.1, lon: 78.1 },
        { lat: 14.2, lon: 78.1 },
      ]),
    ).toEqual([300, null]);
    expect([...idb.cells.values()]).toEqual([300]);
  });

  it('works without IndexedDB, as a memory-only cache', async () => {
    vi.stubGlobal('indexedDB', undefined);
    answerWith(() => 55);
    const provider = await reload();
    expect(await provider.getElevation(15.5, 73.8)).toBe(55);
    expect(await provider.getElevation(15.5, 73.8)).toBe(55);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(idb.cells.size).toBe(0);
  });
});

describe('prefetchElevationGrid', () => {
  const bounds = { south: 12.97, north: 12.972, west: 77.59, east: 77.592 };
  // A plane, so bilinear interpolation between posts is exact.
  const plane = (lat: number, lon: number) => 800 + (lat - 12.97) * 10_000 + (lon - 77.59) * 5_000;

  it('refuses an area over 40,000 posts before any request', async () => {
    const provider = await reload();
    await expect(
      provider.prefetchElevationGrid({ south: 12, north: 13, west: 77, east: 78 }),
    ).rejects.toThrow(new RangeError('Area too large for terrain download'));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('downloads the area so a point inside resolves offline after a reload', async () => {
    answerWith(plane);
    const progress: Array<[number, number]> = [];
    const provider = await reload();
    const result = await provider.prefetchElevationGrid(bounds, 30, (done, total) => progress.push([done, total]));
    const total = progress[0][1];
    expect(total).toBeGreaterThanOrEqual(64);
    expect(result).toEqual({ fetched: total, failed: 0 });
    expect(progress.at(-1)).toEqual([total, total]);

    mockFetch.mockReset();
    mockFetch.mockRejectedValue(new Error('offline'));
    const offline = await reload();
    const elev = await offline.getElevation(12.97123, 77.59087);
    expect(elev).not.toBeNull();
    expect(elev).toBeCloseTo(plane(12.97123, 77.59087), 6);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch posts it already stored', async () => {
    answerWith(plane);
    const provider = await reload();
    const first = await provider.prefetchElevationGrid(bounds);
    const calls = mockFetch.mock.calls.length;
    const again = await provider.prefetchElevationGrid(bounds);
    expect(again).toEqual(first);
    expect(mockFetch).toHaveBeenCalledTimes(calls);
  });

  it('counts posts the API did not answer as failed and stores none of them', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = await reload();
    const result = await provider.prefetchElevationGrid(bounds);
    expect(result.fetched).toBe(0);
    expect(result.failed).toBeGreaterThan(0);
    expect([...idb.cells.keys()].filter((k) => k.startsWith('p:'))).toEqual([]);
  });

  it('stops when aborted', async () => {
    answerWith(plane);
    const provider = await reload();
    const controller = new AbortController();
    controller.abort();
    await expect(provider.prefetchElevationGrid(bounds, 30, undefined, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses to download without persistent storage', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const provider = await reload();
    await expect(provider.prefetchElevationGrid(bounds)).rejects.toThrow(/browser storage/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
