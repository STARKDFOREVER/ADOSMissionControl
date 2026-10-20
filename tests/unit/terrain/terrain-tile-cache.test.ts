/**
 * The terrain tile cache stays bounded: past 400 tiles it trims to 350,
 * least recently used first, and pinned (downloaded) tiles go last.
 * @license GPL-3.0-only
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type * as CacheModule from '@/lib/terrain/terrain-tile-cache';

const idb = vi.hoisted(() => ({ stores: new Map<string, Map<string, unknown>>() }));
vi.mock('idb-keyval', async () => {
  // vi.mock factories are hoisted above static imports.
  const { createIdbMock } = await import('../../helpers/terrarium-png');
  return createIdbMock(idb.stores);
});

const BYTES = new Uint8Array([1, 2, 3]);
let cache: typeof CacheModule;
let clock = 1_000_000;

beforeEach(async () => {
  idb.stores.clear();
  vi.stubGlobal('indexedDB', {});
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = 1_000_000;
  // A fresh module so the stored-tile count starts from the empty store.
  vi.resetModules();
  cache = await import('@/lib/terrain/terrain-tile-cache');
});

afterEach(() => {
  vi.useRealTimers();
});

/** Write tiles `from..to-1`, one millisecond apart. */
async function writeRange(from: number, to: number, pinned: boolean) {
  for (let i = from; i < to; i++) {
    vi.setSystemTime(clock++);
    await cache.writeTile(`t${i}`, BYTES, pinned);
  }
}

const stored = () => [...(idb.stores.get('tiles')?.keys() ?? [])];

describe('terrain tile cache', () => {
  it('reads back a written tile and reports it stored', async () => {
    expect(cache.persistentCacheAvailable()).toBe(true);
    expect(await cache.hasTile('a')).toBe(false);
    await cache.writeTile('a', BYTES, false);
    expect(await cache.hasTile('a')).toBe(true);
    expect(await cache.readTile('a')).toEqual(BYTES);
    expect(await cache.readTile('missing')).toBeUndefined();
  });

  it('keeps a pin through a later unpinned write', async () => {
    await cache.writeTile('a', BYTES, true);
    await cache.writeTile('a', BYTES, false);
    expect(idb.stores.get('index')?.get('a')).toMatchObject({ pinned: true });
  });

  it('trims to 350 tiles past 400, oldest first', async () => {
    await writeRange(0, 400, false);
    expect(stored()).toHaveLength(400);
    await writeRange(400, 401, false);
    const left = stored();
    expect(left).toHaveLength(350);
    expect(idb.stores.get('index')?.size).toBe(350);
    for (let i = 0; i < 51; i++) expect(left).not.toContain(`t${i}`);
    expect(left).toContain('t51');
    expect(left).toContain('t400');
  });

  it('a read marks a tile recently used', async () => {
    await writeRange(0, 400, false);
    vi.setSystemTime(clock++);
    await cache.readTile('t0');
    await writeRange(400, 401, false);
    expect(stored()).toContain('t0');
    expect(stored()).not.toContain('t1');
  });

  it('removes unpinned tiles before pinned ones', async () => {
    await writeRange(0, 10, true);
    await writeRange(10, 401, false);
    const left = stored();
    expect(left).toHaveLength(350);
    for (let i = 0; i < 10; i++) expect(left).toContain(`t${i}`);
    for (let i = 10; i < 61; i++) expect(left).not.toContain(`t${i}`);
  });

  it('reads as a miss without IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.resetModules();
    const bare = await import('@/lib/terrain/terrain-tile-cache');
    expect(bare.persistentCacheAvailable()).toBe(false);
    await bare.writeTile('a', BYTES, true);
    expect(await bare.readTile('a')).toBeUndefined();
    expect(await bare.hasTile('a')).toBe(false);
  });
});
