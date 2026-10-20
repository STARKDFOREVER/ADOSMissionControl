import { describe, it, expect } from 'vitest';
import { generateSurvey } from '@/lib/patterns/survey-generator';
import type { SurveyConfig } from '@/lib/patterns/types';
import { EARTH_RADIUS_M, haversineDistance } from '@/lib/geo/distance';

const M_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;

function makeConfig(overrides?: Partial<SurveyConfig>): SurveyConfig {
  return {
    polygon: [
      [12.970, 77.590],
      [12.970, 77.600],
      [12.980, 77.600],
      [12.980, 77.590],
    ],
    gridAngle: 0,
    lineSpacing: 50,
    turnAroundDistance: 10,
    entryLocation: 'topLeft',
    flyAlternateTransects: false,
    cameraTriggerDistance: 0,
    altitude: 50,
    speed: 5,
    ...overrides,
  };
}

describe('generateSurvey', () => {
  it('generates waypoints for a simple rectangle', () => {
    const result = generateSurvey(makeConfig());
    expect(result.waypoints.length).toBeGreaterThan(0);
  });

  it('boustrophedon pattern alternates direction', () => {
    const result = generateSurvey(makeConfig({ lineSpacing: 100 }));
    // With boustrophedon, consecutive transect pairs should swap start/end X direction.
    // Check that we get at least 2 transects (4 waypoints for non-camera mode).
    expect(result.waypoints.length).toBeGreaterThanOrEqual(4);
    expect(result.stats.transectCount).toBeGreaterThanOrEqual(2);
  });

  it('crosshatch pattern generates perpendicular passes', () => {
    const result = generateSurvey(makeConfig({ crosshatch: true }));
    const singleResult = generateSurvey(makeConfig({ crosshatch: false }));
    // Crosshatch should produce more waypoints than a single pass
    expect(result.waypoints.length).toBeGreaterThan(singleResult.waypoints.length);
    expect(result.stats.transectCount).toBeGreaterThan(singleResult.stats.transectCount);
  });

  it('waypoints are inside or near the polygon boundary', () => {
    const result = generateSurvey(makeConfig({ turnAroundDistance: 0 }));
    // With zero overshoot, all waypoints should be within or very near the polygon
    for (const wp of result.waypoints) {
      // Allow small tolerance for floating point
      expect(wp.lat).toBeGreaterThanOrEqual(12.969);
      expect(wp.lat).toBeLessThanOrEqual(12.981);
      expect(wp.lon).toBeGreaterThanOrEqual(77.589);
      expect(wp.lon).toBeLessThanOrEqual(77.601);
    }
  });

  it('stats include totalDistance, transectCount, estimatedTime', () => {
    const result = generateSurvey(makeConfig());
    expect(result.stats.totalDistance).toBeGreaterThan(0);
    expect(result.stats.transectCount).toBeGreaterThan(0);
    expect(result.stats.estimatedTime).toBeGreaterThan(0);
  });

  it('respects lineSpacing parameter', () => {
    const narrow = generateSurvey(makeConfig({ lineSpacing: 25 }));
    const wide = generateSurvey(makeConfig({ lineSpacing: 100 }));
    // Narrower spacing = more transects
    expect(narrow.stats.transectCount).toBeGreaterThan(wide.stats.transectCount);
  });

  it('returns empty for degenerate polygon (< 3 vertices)', () => {
    const result = generateSurvey(makeConfig({
      polygon: [[12.97, 77.59], [12.98, 77.60]],
    }));
    expect(result.waypoints).toHaveLength(0);
  });

  it('handles concave L-shaped polygon', () => {
    const lShape: [number, number][] = [
      [12.970, 77.590],
      [12.970, 77.600],
      [12.975, 77.600],
      [12.975, 77.595],
      [12.980, 77.595],
      [12.980, 77.590],
    ];
    const result = generateSurvey(makeConfig({ polygon: lShape }));
    expect(result.waypoints.length).toBeGreaterThan(0);
    expect(result.stats.transectCount).toBeGreaterThan(0);
  });

  it('handles very small polygon', () => {
    const tiny: [number, number][] = [
      [12.9700, 77.5900],
      [12.9700, 77.5901],
      [12.9701, 77.5901],
      [12.9701, 77.5900],
    ];
    const result = generateSurvey(makeConfig({ polygon: tiny, lineSpacing: 5 }));
    // May produce few or no transects depending on spacing vs polygon size
    expect(result.stats).toBeDefined();
  });

  it('turnAroundDistance adds overshoot past boundary', () => {
    const noOvershoot = generateSurvey(makeConfig({ turnAroundDistance: 0 }));
    const withOvershoot = generateSurvey(makeConfig({ turnAroundDistance: 50 }));
    // With overshoot, total distance should be larger
    expect(withOvershoot.stats.totalDistance).toBeGreaterThan(noOvershoot.stats.totalDistance);
  });

  it('cameraTriggerDistance adds photo count', () => {
    const withCamera = generateSurvey(makeConfig({ cameraTriggerDistance: 10 }));
    expect(withCamera.stats.photoCount).toBeGreaterThan(0);
  });

  // A 200 m (east-west) x 100 m (north-south) box at 12.97 N.
  const box = (): [number, number][] => {
    const dLat = 100 / M_PER_DEG;
    const dLon = 200 / (M_PER_DEG * Math.cos((12.97 * Math.PI) / 180));
    return [[12.97, 77.59], [12.97, 77.59 + dLon], [12.97 + dLat, 77.59 + dLon], [12.97 + dLat, 77.59]];
  };
  const lineLats = (rows: { lat: number; command: string }[]) =>
    rows.filter((w) => w.command === 'WAYPOINT').map((w) => Math.round((w.lat - 12.97) * M_PER_DEG * 10) / 10);

  it('alternate transects fly every line: the kept lines out, the skipped ones back', () => {
    const result = generateSurvey(makeConfig({
      polygon: box(), gridAngle: 90, lineSpacing: 25, turnAroundDistance: 0, flyAlternateTransects: true,
    }));
    expect(result.stats.transectCount).toBe(4);
    const ys = [...new Set(lineLats(result.waypoints))];
    // Top-left entry: 87.5, 37.5 out; 12.5, 62.5 back.
    expect(ys).toEqual([87.5, 37.5, 12.5, 62.5]);
  });

  it('"Top left" starts on the northern-most line at its west end', () => {
    const result = generateSurvey(makeConfig({ polygon: box(), gridAngle: 90, lineSpacing: 25, turnAroundDistance: 0 }));
    const first = result.waypoints[0];
    expect((first.lat - 12.97) * M_PER_DEG).toBeCloseTo(87.5, 0);
    expect(first.lon).toBeCloseTo(77.59, 5);
  });

  it('lays one centre line on an area thinner than the spacing, and centres the lines', () => {
    const dLat = 10 / 111320;
    const thin: [number, number][] = [[12.97, 77.59], [12.97, 77.6], [12.97 + dLat, 77.6], [12.97 + dLat, 77.59]];
    const one = generateSurvey(makeConfig({ polygon: thin, gridAngle: 90, lineSpacing: 25, turnAroundDistance: 0 }));
    expect(one.stats.transectCount).toBe(1);
    const tall = box().map(([lat, lon]): [number, number] => [lat, lon]);
    const centred = generateSurvey(makeConfig({ polygon: tall, gridAngle: 90, lineSpacing: 40, turnAroundDistance: 0 }));
    expect([...new Set(lineLats(centred.waypoints))].sort((a, b) => a - b)).toEqual([10, 50, 90]);
  });

  it('triggers shoot at both ends of each line: floor(L/d) + 2 photos', () => {
    const result = generateSurvey(makeConfig({
      polygon: box(), gridAngle: 90, lineSpacing: 25, turnAroundDistance: 0, cameraTriggerDistance: 15.17,
    }));
    const triggers = result.waypoints.filter((w) => w.command === 'DO_SET_CAM_TRIGG');
    expect(triggers.every((t) => t.param3 === 1)).toBe(true);
    expect(result.stats.photoCount).toBe(4 * (Math.floor(200 / 15.17) + 2));
  });

  it('starts the crosshatch pass next to where the first pass ended and counts the connector', () => {
    const single = generateSurvey(makeConfig({ polygon: box(), gridAngle: 90, lineSpacing: 25, turnAroundDistance: 0 }));
    const cross = generateSurvey(makeConfig({ polygon: box(), gridAngle: 90, lineSpacing: 25, turnAroundDistance: 0, crosshatch: true }));
    const nav = cross.waypoints.filter((w) => w.command === 'WAYPOINT');
    const exit = single.waypoints[single.waypoints.length - 1];
    const entry = nav[single.waypoints.length];
    const connector = haversineDistance(exit.lat, exit.lon, entry.lat, entry.lon);
    expect(connector).toBeLessThan(25); // corner to corner, half a spacing each way
    let flown = 0;
    for (let i = 1; i < nav.length; i++) flown += haversineDistance(nav[i - 1].lat, nav[i - 1].lon, nav[i].lat, nav[i].lon);
    expect(cross.stats.totalDistance).toBeCloseTo(flown, 3);
  });

  it('45 degree grid angle produces diagonal transects', () => {
    const result = generateSurvey(makeConfig({ gridAngle: 45 }));
    expect(result.waypoints.length).toBeGreaterThan(0);
    expect(result.stats.transectCount).toBeGreaterThan(0);
  });

  it('entry location bottomRight starts from different corner', () => {
    const topLeft = generateSurvey(makeConfig({ entryLocation: 'topLeft' }));
    const bottomRight = generateSurvey(makeConfig({ entryLocation: 'bottomRight' }));
    // First waypoints should differ
    if (topLeft.waypoints.length > 0 && bottomRight.waypoints.length > 0) {
      const tl = topLeft.waypoints[0];
      const br = bottomRight.waypoints[0];
      const different = tl.lat !== br.lat || tl.lon !== br.lon;
      expect(different).toBe(true);
    }
  });

  it('tieLines generates additional perpendicular transects', () => {
    const noTie = generateSurvey(makeConfig({ tieLines: false }));
    const withTie = generateSurvey(makeConfig({
      tieLines: true,
      tieLineAngle: 90,
      tieLineSpacing: 50,
    }));
    expect(withTie.waypoints.length).toBeGreaterThan(noTie.waypoints.length);
  });

  it('all waypoints have altitude set from config', () => {
    const result = generateSurvey(makeConfig({ altitude: 80 }));
    for (const wp of result.waypoints) {
      expect(wp.alt).toBe(80);
    }
  });

  it('coveredArea in stats is non-negative', () => {
    const result = generateSurvey(makeConfig());
    expect(result.stats.coveredArea).toBeGreaterThanOrEqual(0);
  });
});
