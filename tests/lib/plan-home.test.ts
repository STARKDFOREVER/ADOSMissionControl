/**
 * Tests for the plan-home gate: a vehicle-reported home counts for a plan only
 * when it lies near the plan's launch point.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import type { Waypoint } from "@/lib/types";
import { isHomeNearPlan, planLaunchPoint } from "@/lib/mission/plan-home";

const PLAN: Waypoint[] = [
  { id: "t", lat: 36.0602, lon: -112.1155, alt: 30, command: "TAKEOFF" },
  { id: "w1", lat: 36.065, lon: -112.11, alt: 60, command: "WAYPOINT" },
  { id: "r", lat: 36.065, lon: -112.11, alt: 60, command: "RTL" },
];

describe("isHomeNearPlan", () => {
  it("rejects a home on another continent", () => {
    expect(isHomeNearPlan({ lat: 12.95, lon: 77.666 }, PLAN)).toBe(false);
  });

  it("accepts a home a couple of kilometres from the launch point", () => {
    // 0.018 deg of latitude is about 2 km.
    expect(isHomeNearPlan({ lat: 36.0782, lon: -112.1155 }, PLAN)).toBe(true);
  });

  it("accepts a home with no coordinates", () => {
    expect(isHomeNearPlan({}, PLAN)).toBe(true);
  });

  it("accepts any home when the plan has no launch point", () => {
    const rtlOnly: Waypoint[] = [{ id: "r", lat: 0, lon: 0, alt: 0, command: "RTL" }];
    expect(isHomeNearPlan({ lat: 12.95, lon: 77.666 }, rtlOnly)).toBe(true);
  });
});

describe("planLaunchPoint", () => {
  it("skips a positionless TAKEOFF and returns the next positioned item", () => {
    const plan: Waypoint[] = [
      { id: "t", lat: 0, lon: 0, alt: 30, command: "TAKEOFF" },
      { id: "w1", lat: 36.065, lon: -112.11, alt: 60, command: "WAYPOINT" },
    ];
    expect(planLaunchPoint(plan)).toEqual({ lat: 36.065, lon: -112.11 });
  });

  it("skips a DO_LAND_START marker, which the vehicle never flies to", () => {
    const plan: Waypoint[] = [
      { id: "ls", lat: 36.1, lon: -112.2, alt: 0, command: "DO_LAND_START" },
      { id: "w1", lat: 36.065, lon: -112.11, alt: 60, command: "WAYPOINT" },
    ];
    expect(planLaunchPoint(plan)).toEqual({ lat: 36.065, lon: -112.11 });
  });
});
