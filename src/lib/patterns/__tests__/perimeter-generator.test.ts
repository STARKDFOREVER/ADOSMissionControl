import { describe, it, expect } from "vitest";
import { generatePerimeter } from "../perimeter-generator";
import { haversineDistance, pointInPolygon } from "@/lib/geo/distance";

// About 200 m x 200 m around a synthetic origin.
const SQUARE: [number, number][] = [
  [12.0, 77.0],
  [12.0018, 77.0],
  [12.0018, 77.00184],
  [12.0, 77.00184],
];

describe("generatePerimeter", () => {
  it("perimeter_generator_closed_loop: one pass that ends where it starts", () => {
    const r = generatePerimeter({ polygon: SQUARE, offsetM: 0, altitude: 40, speed: 5 });
    expect(r.waypoints).toHaveLength(SQUARE.length + 1);
    const first = r.waypoints[0];
    const last = r.waypoints[r.waypoints.length - 1];
    expect(last.lat).toBe(first.lat);
    expect(last.lon).toBe(first.lon);
    expect(r.waypoints.every((w) => w.alt === 40 && w.command === "WAYPOINT")).toBe(true);
    // Roughly the 800 m perimeter of the square.
    expect(r.stats.totalDistance).toBeGreaterThan(780);
    expect(r.stats.totalDistance).toBeLessThan(820);
    expect(r.stats.estimatedTime).toBeCloseTo(r.stats.totalDistance / 5, 6);
  });

  it("insets every vertex inside the boundary by the offset", () => {
    const r = generatePerimeter({ polygon: SQUARE, offsetM: 20, altitude: 40, speed: 5 });
    expect(r.waypoints).toHaveLength(SQUARE.length + 1);
    for (const w of r.waypoints) {
      expect(pointInPolygon([w.lat, w.lon], SQUARE)).toBe(true);
    }
    // The inset corner sits about 20 m in on both axes (about 28 m diagonal).
    const d = haversineDistance(SQUARE[0][0], SQUARE[0][1], r.waypoints[0].lat, r.waypoints[0].lon);
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(31);
    expect(r.stats.totalDistance).toBeLessThan(800 - 4 * 30);
  });

  it("rejects an offset that collapses the polygon", () => {
    expect(() => generatePerimeter({ polygon: SQUARE, offsetM: 150, altitude: 40, speed: 5 })).toThrow(/collapses/);
  });

  it("returns nothing for a degenerate polygon", () => {
    expect(generatePerimeter({ polygon: SQUARE.slice(0, 2), offsetM: 0, altitude: 40, speed: 5 }).waypoints).toEqual([]);
  });
});
