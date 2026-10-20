import { describe, it, expect } from 'vitest';
import {
  generateExpandingSquare,
  generateSectorSearch,
  generateParallelTrack,
} from '@/lib/patterns/sar-generators';
import { bearing } from '@/lib/drawing/geo-utils';

describe('generateExpandingSquare', () => {
  it('generates expanding pattern with increasing leg lengths', () => {
    const result = generateExpandingSquare({
      center: [12.97, 77.59],
      legSpacing: 50,
      maxLegs: 8,
      altitude: 50,
      speed: 5,
      startBearing: 0,
    });
    // 1 start waypoint + 8 leg endpoints = 9 waypoints
    expect(result.waypoints).toHaveLength(9);
    expect(result.stats.totalDistance).toBeGreaterThan(0);
    expect(result.stats.estimatedTime).toBeGreaterThan(0);
  });

  it('starts at the center datum point', () => {
    const result = generateExpandingSquare({
      center: [12.97, 77.59],
      legSpacing: 50,
      maxLegs: 4,
      altitude: 50,
      speed: 5,
      startBearing: 0,
    });
    expect(result.waypoints[0].lat).toBeCloseTo(12.97, 5);
    expect(result.waypoints[0].lon).toBeCloseTo(77.59, 5);
  });
});

describe('generateSectorSearch', () => {
  const sector = () => generateSectorSearch({
    center: [12.97, 77.59],
    radius: 200,
    altitude: 50,
    speed: 5,
    startBearing: 0,
  });

  it('flies three triangles: nine legs of one radius each', () => {
    const result = sector();
    // 1 start + 3 triangles * 3 waypoints each (outbound, cross, back to datum) = 10
    expect(result.waypoints).toHaveLength(10);
    expect(result.stats.legCount).toBe(9);
    expect(result.stats.totalDistance).toBeCloseTo(9 * 200, -1);
  });

  it('returns to datum after each triangle', () => {
    const result = sector();
    for (const i of [3, 6, 9]) {
      expect(result.waypoints[i].lat).toBeCloseTo(12.97, 4);
      expect(result.waypoints[i].lon).toBeCloseTo(77.59, 4);
    }
  });

  it('turns 120° right at every corner and crosses the datum without a turn', () => {
    const wps = sector().waypoints;
    const headings: number[] = [];
    for (let i = 1; i < wps.length; i++) {
      headings.push(bearing(wps[i - 1].lat, wps[i - 1].lon, wps[i].lat, wps[i].lon));
    }
    const turn = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;
    // Outbound radials 000, 240, 120: the leg back into the datum carries on.
    expect(headings[0]).toBeCloseTo(0, 0);
    expect(headings[3]).toBeCloseTo(240, 0);
    expect(headings[6]).toBeCloseTo(120, 0);
    for (let i = 1; i < headings.length; i++) {
      const expected = i % 3 === 0 ? 0 : 120;
      expect(Math.abs(turn(headings[i - 1], headings[i]) - expected)).toBeLessThan(1);
    }
  });
});

describe('SAR leg counts', () => {
  it('reports the legs of an expanding square', () => {
    const result = generateExpandingSquare({
      center: [12.97, 77.59], legSpacing: 50, maxLegs: 20, altitude: 50, speed: 5, startBearing: 0,
    });
    expect(result.stats.legCount).toBe(20);
    expect(result.stats.transectCount).toBe(0);
  });
});

describe('generateParallelTrack', () => {
  it('generates parallel track lines', () => {
    const result = generateParallelTrack({
      startPoint: [12.97, 77.59],
      trackLength: 500,
      trackSpacing: 50,
      trackCount: 5,
      bearing: 0,
      altitude: 50,
      speed: 5,
    });
    // 5 tracks * 2 waypoints each = 10
    expect(result.waypoints).toHaveLength(10);
    expect(result.stats.totalDistance).toBeGreaterThan(0);
    expect(result.stats.estimatedTime).toBeGreaterThan(0);
  });

  it('alternates track direction (boustrophedon)', () => {
    const result = generateParallelTrack({
      startPoint: [12.97, 77.59],
      trackLength: 500,
      trackSpacing: 50,
      trackCount: 4,
      bearing: 0, // north
      altitude: 50,
      speed: 5,
    });
    // Track 0: goes north. Track 1: goes south (reversed).
    // Track 0 start should be south of track 0 end
    expect(result.waypoints[0].lat).toBeLessThan(result.waypoints[1].lat);
    // Track 1 start should be north of track 1 end (reversed)
    expect(result.waypoints[2].lat).toBeGreaterThan(result.waypoints[3].lat);
  });
});
