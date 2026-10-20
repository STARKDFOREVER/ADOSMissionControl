/**
 * Ground sampled along a leg: evenly spaced, never farther apart than the
 * requested spacing, both endpoints included, unknown ground kept unknown.
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { haversineDistance } from '@/lib/geo/distance';

const getElevations = vi.fn<(points: Array<{ lat: number; lon: number }>, signal?: AbortSignal) => Promise<Array<number | null>>>();
vi.mock('@/lib/terrain/terrain-provider', () => ({
  getElevations: (points: Array<{ lat: number; lon: number }>, signal?: AbortSignal) => getElevations(points, signal),
}));

import { sampleGroundAlong, legSamplePoints } from '@/lib/terrain/ground-sampler';

const a = { lat: 12.97, lon: 77.59 };
/** ~100 m north of `a`. */
const b = { lat: 12.97 + 100 / 111_195, lon: 77.59 };

beforeEach(() => {
  getElevations.mockReset();
  getElevations.mockImplementation(async (points) => points.map((_, i) => 400 + i));
});

describe('sampleGroundAlong', () => {
  it('samples a 100 m leg every 25 m with both endpoints', async () => {
    const samples = await sampleGroundAlong(a, b);
    const length = haversineDistance(a.lat, a.lon, b.lat, b.lon);
    expect(samples.map((s) => s.distM)).toEqual([0, 0.25, 0.5, 0.75, 1].map((f) => length * f));
    expect(samples.map((s) => s.groundAmsl)).toEqual([400, 401, 402, 403, 404]);

    const [points] = getElevations.mock.calls[0];
    expect(points[0]).toMatchObject(a);
    expect(points.at(-1)).toMatchObject(b);
  });

  it('never leaves a gap wider than the spacing', () => {
    const far = { lat: 13.01, lon: 77.63 };
    for (const spacing of [7, 30, 55]) {
      const pts = legSamplePoints(a, far, spacing);
      for (let i = 1; i < pts.length; i++) {
        expect(pts[i].distM - pts[i - 1].distM).toBeLessThanOrEqual(spacing + 1e-9);
      }
      expect(pts.at(-1)).toMatchObject(far);
    }
  });

  it('keeps an unresolved sample as null, never 0', async () => {
    getElevations.mockResolvedValueOnce([400, null, 402, 403, 404]);
    const samples = await sampleGroundAlong(a, b);
    expect(samples[1].groundAmsl).toBeNull();
  });

  it('returns the two coincident endpoints for a zero-length leg', async () => {
    const samples = await sampleGroundAlong(a, a);
    expect(samples.map((s) => s.distM)).toEqual([0, 0]);
  });

  it('passes the abort signal through and rejects a non-positive spacing', async () => {
    const controller = new AbortController();
    await sampleGroundAlong(a, b, 30, controller.signal);
    expect(getElevations.mock.calls[0][1]).toBe(controller.signal);
    await expect(sampleGroundAlong(a, b, 0)).rejects.toBeInstanceOf(RangeError);
  });
});
