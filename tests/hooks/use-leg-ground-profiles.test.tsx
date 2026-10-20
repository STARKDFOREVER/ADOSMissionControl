/**
 * Ground under each flown leg, keyed `${fromId}>${toId}`, for the leg
 * terrain-clearance check: legs with unknown ground are left out, RTL and
 * 0/0 items never start or end a leg, and callers asking for the same legs
 * share one sampling.
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Waypoint } from '@/lib/types';

type Sample = { distM: number; groundAmsl: number | null };
const sampleGroundAlong = vi.fn<(a: { lat: number; lon: number }, b: { lat: number; lon: number }, spacingM?: number) => Promise<Sample[]>>();
vi.mock('@/lib/terrain/ground-sampler', () => ({
  sampleGroundAlong: (a: { lat: number; lon: number }, b: { lat: number; lon: number }, spacingM?: number) =>
    sampleGroundAlong(a, b, spacingM),
}));

import { useLegGroundProfiles, flownLegs } from '@/hooks/use-terrain-profile';

// Leg results are shared module-wide by geometry, so every test uses its own area.
let area = 0;
function wp(id: string, i: number, extra: Partial<Waypoint> = {}): Waypoint {
  return { id, lat: 10 + area * 0.1 + i * 0.001, lon: 77, alt: 50, ...extra };
}

beforeEach(() => {
  area++;
  vi.useFakeTimers();
  sampleGroundAlong.mockReset();
  sampleGroundAlong.mockImplementation(async () => [
    { distM: 0, groundAmsl: 400 },
    { distM: 30, groundAmsl: 410 },
    { distM: 60, groundAmsl: 420 },
  ]);
});

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

describe('useLegGroundProfiles', () => {
  it('keys each flown leg by from>to id and is undefined until the first sampling lands', async () => {
    const waypoints = [wp('t', 0, { command: 'TAKEOFF' }), wp('a', 1), wp('b', 2)];
    const { result } = renderHook(() => useLegGroundProfiles(waypoints));
    expect(result.current).toBeUndefined();
    await settle();
    expect([...result.current!.keys()]).toEqual(['t>a', 'a>b']);
    expect(result.current!.get('t>a')).toEqual([400, 410, 420]);
    expect(sampleGroundAlong).toHaveBeenCalledWith(
      { lat: waypoints[0].lat, lon: 77 },
      { lat: waypoints[1].lat, lon: 77 },
      30,
    );
  });

  it('omits a leg with any unresolved sample', async () => {
    const waypoints = [wp('a', 0), wp('b', 1), wp('c', 2)];
    sampleGroundAlong.mockImplementation(async (from) =>
      from.lat === waypoints[1].lat
        ? [{ distM: 0, groundAmsl: 400 }, { distM: 30, groundAmsl: null }]
        : [{ distM: 0, groundAmsl: 400 }, { distM: 30, groundAmsl: 405 }],
    );
    const { result } = renderHook(() => useLegGroundProfiles(waypoints));
    await settle();
    expect([...result.current!.keys()]).toEqual(['a>b']);
  });

  it('skips RTL, 0/0, inherited-position and DO_LAND_START items and stops at LAND', () => {
    const legs = flownLegs([
      wp('a', 0),
      wp('ls', 1, { command: 'DO_LAND_START' }),
      wp('z', 2, { lat: 0, lon: 0, command: 'LOITER' }),
      wp('i', 3, { inheritsPosition: true, command: 'LOITER_TIME' }),
      wp('b', 4),
      wp('l', 5, { command: 'LAND' }),
      wp('after', 6),
    ]);
    expect(legs.map((l) => l.key)).toEqual(['a>b', 'b>l']);
    expect(flownLegs([wp('a', 0), wp('b', 1), wp('r', 2, { command: 'RTL' }), wp('c', 3)]).map((l) => l.key)).toEqual(['a>b']);
  });

  it('samples each leg once for several callers and keeps the Map identity on re-render', async () => {
    const waypoints = [wp('a', 0), wp('b', 1)];
    const first = renderHook(({ w }) => useLegGroundProfiles(w), { initialProps: { w: waypoints } });
    const second = renderHook(() => useLegGroundProfiles(waypoints));
    await settle();
    expect(sampleGroundAlong).toHaveBeenCalledTimes(1);
    const map = first.result.current;
    expect(map).toBeDefined();
    expect(second.result.current).toBe(map);

    // A new array with the same content keeps the same Map.
    first.rerender({ w: waypoints.map((w) => ({ ...w })) });
    await settle();
    expect(first.result.current).toBe(map);
    expect(sampleGroundAlong).toHaveBeenCalledTimes(1);
  });

  it('keeps known legs while an edited leg is re-sampled', async () => {
    const waypoints = [wp('a', 0), wp('b', 1), wp('c', 2)];
    const { result, rerender } = renderHook(({ w }) => useLegGroundProfiles(w), { initialProps: { w: waypoints } });
    await settle();
    expect(result.current!.size).toBe(2);

    const pendingLeg = Promise.withResolvers<Sample[]>();
    sampleGroundAlong.mockImplementation(() => pendingLeg.promise);
    const moved = [waypoints[0], waypoints[1], { ...waypoints[2], lon: 77.001 }];
    rerender({ w: moved });
    await settle();
    expect([...result.current!.keys()]).toEqual(['a>b']);

    await act(async () => {
      pendingLeg.resolve([{ distM: 0, groundAmsl: 400 }, { distM: 30, groundAmsl: 401 }]);
    });
    expect([...result.current!.keys()]).toEqual(['a>b', 'b>c']);
  });
});
