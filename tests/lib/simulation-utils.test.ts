import { describe, expect, it } from "vitest";
import type { Waypoint } from "@/lib/types";
import { createSimulationMissionSignature, interpolatePosition } from "@/lib/simulation-utils";
import { computeFlightPlan } from "@/lib/flight-plan";
import { haversineDistance } from "@/lib/geo/distance";

const baseWaypoints: Waypoint[] = [
  { id: "wp-1", lat: 12.9716, lon: 77.5946, alt: 30, command: "TAKEOFF" },
  { id: "wp-2", lat: 12.972, lon: 77.595, alt: 45, speed: 8 },
];

describe("createSimulationMissionSignature", () => {
  it("stays stable for equivalent simulation inputs", () => {
    expect(createSimulationMissionSignature(baseWaypoints, 6, "relative")).toBe(
      createSimulationMissionSignature([...baseWaypoints], 6, "relative")
    );
  });

  it("changes when same-count waypoint content changes", () => {
    const changed = [
      baseWaypoints[0],
      { ...baseWaypoints[1], lat: baseWaypoints[1].lat + 0.001 },
    ];

    expect(createSimulationMissionSignature(changed, 6, "relative")).not.toBe(
      createSimulationMissionSignature(baseWaypoints, 6, "relative")
    );
  });

  it("changes when default speed changes", () => {
    expect(createSimulationMissionSignature(baseWaypoints, 7, "relative")).not.toBe(
      createSimulationMissionSignature(baseWaypoints, 6, "relative")
    );
  });

  it("changes when the planner default frame or a waypoint's own frame changes", () => {
    const base = createSimulationMissionSignature(baseWaypoints, 6, "relative");
    expect(createSimulationMissionSignature(baseWaypoints, 6, "terrain")).not.toBe(base);
    const framed = [baseWaypoints[0], { ...baseWaypoints[1], frame: "absolute" as const }];
    expect(createSimulationMissionSignature(framed, 6, "relative")).not.toBe(base);
  });
});

describe("computeFlightPlan RTL and action items", () => {
  // Launch, then a waypoint about 2 km north, then RTL placed (as the planner
  // does) at the last waypoint's position at 0 m.
  const launch = { lat: 12.9716, lon: 77.5946 };
  const far = { lat: 12.9896, lon: 77.5946 };
  const mission: Waypoint[] = [
    { id: "t", ...launch, alt: 30, command: "TAKEOFF" },
    { id: "w", ...far, alt: 30 },
    { id: "r", ...far, alt: 0, command: "RTL" },
  ];

  it("flies RTL back to home instead of descending in place", () => {
    const plan = computeFlightPlan(mission, 10);
    const leg = haversineDistance(launch.lat, launch.lon, far.lat, far.lon);
    // Out and back: never just the outbound leg.
    expect(plan.totalDistance).toBeCloseTo(2 * leg, 3);
    const end = interpolatePosition(plan.segments, mission, plan.totalDuration);
    expect(end.lat).toBeCloseTo(launch.lat, 6);
    expect(end.lon).toBeCloseTo(launch.lon, 6);
    expect(end.alt).toBe(0);
  });

  it("never flies to a positionless action item", () => {
    const withAction: Waypoint[] = [
      mission[0],
      { id: "a", lat: 0, lon: 0, alt: 0, command: "DO_SET_SPEED", param1: 5 },
      mission[1],
    ];
    const plan = computeFlightPlan(withAction, 10);
    const leg = haversineDistance(launch.lat, launch.lon, far.lat, far.lon);
    expect(plan.totalDistance).toBeCloseTo(leg, 0);
  });
});

describe("computeFlightPlan launch point and return altitude", () => {
  const launch = { lat: 12.9716, lon: 77.5946 };
  const far = { lat: 12.9896, lon: 77.5946 };
  // A downloaded mission: TAKEOFF saved without a position, a waypoint, RTL.
  const downloaded: Waypoint[] = [
    { id: "t", lat: 0, lon: 0, alt: 30, command: "TAKEOFF" },
    { id: "w", ...far, alt: 30 },
    { id: "r", lat: 0, lon: 0, alt: 0, command: "RTL" },
  ];

  it("never starts the flight from 0/0 for a positionless first item", () => {
    const plan = computeFlightPlan(downloaded, 10);
    // Without a planned home the flight starts at the first positioned item, so
    // nothing is flown from null island (thousands of km away).
    expect(plan.totalDistance).toBeLessThan(1000);
    expect(plan.segments[0].from.lat).toBeCloseTo(far.lat, 6);
  });

  it("launches from and returns to the planned home at the return altitude", () => {
    const plan = computeFlightPlan(downloaded, 10, { home: launch, rtlAltM: 60 });
    const leg = haversineDistance(launch.lat, launch.lon, far.lat, far.lon);
    expect(plan.segments[0].from.lat).toBeCloseTo(launch.lat, 6);
    // Out and back, horizontally.
    expect(plan.totalDistance).toBeCloseTo(2 * leg, 3);
    expect(Math.max(...plan.segments.map((s) => s.to.alt))).toBe(60);
    const end = interpolatePosition(plan.segments, downloaded, plan.totalDuration);
    expect(end.lat).toBeCloseTo(launch.lat, 6);
    expect(end.alt).toBe(0);
  });
});
