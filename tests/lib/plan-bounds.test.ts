/**
 * planAreaBounds: the box around everything a plan places on the map, grown by
 * the buffer, with circles counted at their full radius and nothing at all
 * giving no area.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { planAreaBounds, type PlanAreaFence } from "@/lib/geo/plan-bounds";
import { haversineDistance } from "@/lib/geo/distance";

const NO_FENCE: PlanAreaFence = { fenceType: "polygon", circleCenter: null, circleRadius: 0, polygonPoints: [], zones: [] };

describe("planAreaBounds", () => {
  it("is null for a plan that places nothing", () => {
    expect(planAreaBounds([], null, NO_FENCE, [])).toBeNull();
    // 0/0 is "here" on the wire, not a place on the map.
    expect(planAreaBounds([{ lat: 0, lon: 0 }], null, NO_FENCE, [])).toBeNull();
  });

  it("encloses waypoints, home, rally and fence plus a 500 m buffer on every side", () => {
    const b = planAreaBounds(
      [{ lat: 12.97, lon: 77.59 }, { lat: 12.98, lon: 77.6 }],
      { lat: 12.965, lon: 77.585 },
      { ...NO_FENCE, polygonPoints: [[12.99, 77.6], [12.99, 77.61], [12.985, 77.61]] },
      [{ lat: 12.97, lon: 77.62 }],
    )!;
    // Edges: south home 12.965, north fence 12.99, west home 77.585, east rally 77.62.
    expect(haversineDistance(12.99, 77.6, b.north, 77.6)).toBeCloseTo(500, -1);
    expect(haversineDistance(12.965, 77.6, b.south, 77.6)).toBeCloseTo(500, -1);
    expect(haversineDistance(12.99, 77.62, 12.99, b.east)).toBeGreaterThanOrEqual(499);
    expect(haversineDistance(12.99, 77.585, 12.99, b.west)).toBeGreaterThanOrEqual(499);
    expect(haversineDistance(12.99, 77.62, 12.99, b.east)).toBeLessThan(520);
  });

  it("takes the buffer as given", () => {
    const b = planAreaBounds([{ lat: 10, lon: 20 }], null, NO_FENCE, [], 1000)!;
    expect(haversineDistance(10, 20, b.north, 20)).toBeCloseTo(1000, -1);
    expect(b.south).toBeLessThan(10);
    expect(b.west).toBeLessThan(20);
    expect(b.east).toBeGreaterThan(20);
  });

  it("counts a circle fence at its full radius", () => {
    const b = planAreaBounds(
      [{ lat: 10, lon: 20 }],
      null,
      { ...NO_FENCE, fenceType: "circle", circleCenter: [10, 20], circleRadius: 2000 },
      [],
      0,
    )!;
    expect(haversineDistance(10, 20, b.north, 20)).toBeCloseTo(2000, -1);
    expect(haversineDistance(10, 20, 10, b.east)).toBeCloseTo(2000, -1);
  });
});
