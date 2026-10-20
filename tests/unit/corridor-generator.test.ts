import { describe, it, expect } from 'vitest';
import { generateCorridor } from '@/lib/patterns/corridor-generator';
import type { CorridorConfig, PatternWaypoint } from '@/lib/patterns/types';
import { haversineDistance } from '@/lib/geo/distance';
import { offsetPoint } from '@/lib/drawing/geo-utils';

function makeConfig(overrides?: Partial<CorridorConfig>): CorridorConfig {
  return {
    pathPoints: [
      [12.970, 77.590],
      [12.980, 77.590],
    ],
    corridorWidth: 100,
    lineSpacing: 50,
    altitude: 50,
    speed: 5,
    ...overrides,
  };
}

const nav = (rows: PatternWaypoint[]) => rows.filter((w) => w.command === 'WAYPOINT');

describe('generateCorridor', () => {
  it('flies a straight 1 km x 50 m corridor as 3 lines along the path, with triggers', () => {
    const start: [number, number] = [12.97, 77.59];
    const end = offsetPoint(start[0], start[1], 0, 1000);
    const result = generateCorridor(makeConfig({
      pathPoints: [start, end], corridorWidth: 50, lineSpacing: 20, cameraTriggerDistance: 15,
    }));
    expect(result.stats.transectCount).toBe(3);
    const wps = nav(result.waypoints);
    // Each line: an along-path pair 1 km long, offset −20, 0 and +20 m from the center.
    expect(wps).toHaveLength(6);
    for (let i = 0; i < 6; i += 2) {
      expect(haversineDistance(wps[i].lat, wps[i].lon, wps[i + 1].lat, wps[i + 1].lon)).toBeCloseTo(1000, -1);
    }
    const offsets = [0, 2, 4].map((i) => (wps[i].lon - start[1]) * 111320 * Math.cos((start[0] * Math.PI) / 180));
    expect(offsets.map((o) => Math.round(o)).sort((a, b) => a - b)).toEqual([-20, 0, 20]);
    // Directions alternate, and the camera is armed and disarmed once per line.
    expect(wps[0].lat).toBeLessThan(wps[1].lat);
    expect(wps[2].lat).toBeGreaterThan(wps[3].lat);
    const triggers = result.waypoints.filter((w) => w.command === 'DO_SET_CAM_TRIGG');
    expect(triggers.map((t) => t.param1)).toEqual([15, 0, 15, 0, 15, 0]);
    expect(triggers.every((t) => t.param3 === 1)).toBe(true);
    expect(result.stats.photoCount).toBe(3 * (Math.floor(1000 / 15) + 2));
    expect(result.stats.totalDistance).toBeCloseTo(3040, -1);
  });

  it('keeps every line the same offset from the path at a 90° bend (mitred join)', () => {
    const a: [number, number] = [12.97, 77.59];
    const b = offsetPoint(a[0], a[1], 0, 500);
    const c = offsetPoint(b[0], b[1], 90, 500);
    const result = generateCorridor(makeConfig({ pathPoints: [a, b, c], corridorWidth: 60, lineSpacing: 30 }));
    expect(result.stats.transectCount).toBe(2);
    // The outer line's corner sits on the bisector at offset·√2 from the bend.
    const corners = nav(result.waypoints).filter((w) => {
      const d = haversineDistance(w.lat, w.lon, b[0], b[1]);
      return d > 10 && d < 30;
    });
    expect(corners).toHaveLength(2);
    for (const corner of corners) {
      expect(haversineDistance(corner.lat, corner.lon, b[0], b[1])).toBeCloseTo(15 * Math.SQRT2, 0);
    }
  });

  it('adds the turn-around overshoot at each line end', () => {
    const plain = generateCorridor(makeConfig());
    const turned = generateCorridor(makeConfig({ turnAroundDistance: 20 }));
    expect(turned.stats.totalDistance - plain.stats.totalDistance).toBeCloseTo(2 * 2 * 20, -1);
  });

  it('hovers and shoots at each capture point with hover-and-capture', () => {
    const start: [number, number] = [12.97, 77.59];
    const end = offsetPoint(start[0], start[1], 0, 100);
    const result = generateCorridor(makeConfig({
      pathPoints: [start, end], corridorWidth: 10, lineSpacing: 20, cameraTriggerDistance: 25, hoverAndCapture: true,
    }));
    const wps = nav(result.waypoints);
    expect(wps).toHaveLength(5); // 0, 25, 50, 75, 100 m
    expect(wps.every((w) => w.holdTime === 1)).toBe(true);
    expect(result.waypoints.filter((w) => w.command === 'DO_DIGICAM')).toHaveLength(5);
    expect(result.waypoints.some((w) => w.command === 'DO_SET_CAM_TRIGG')).toBe(false);
    expect(result.stats.photoCount).toBe(5);
  });

  it('returns empty for single-point path', () => {
    const result = generateCorridor(makeConfig({
      pathPoints: [[12.97, 77.59]],
    }));
    expect(result.waypoints).toHaveLength(0);
  });
});
