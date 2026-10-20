/**
 * Planner keyboard edits: the arrow nudge moves the same ground distance east
 * as north at any latitude, and a paste re-points jumps at the pasted copies.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { nudgeWaypoints, pasteWaypoints } from "@/app/plan/waypoint-edits";
import { haversineDistance } from "@/lib/geo/distance";
import type { Waypoint } from "@/lib/types";

describe("nudgeWaypoints", () => {
  it("moves as far east as north at 60 degrees latitude", () => {
    const start: Waypoint = { id: "a", lat: 60, lon: 10, alt: 50 };
    const [north] = nudgeWaypoints([start], ["a"], 1e-5, 0);
    const [east] = nudgeWaypoints([start], ["a"], 0, 1e-5);
    const dNorth = haversineDistance(start.lat, start.lon, north.lat, north.lon);
    const dEast = haversineDistance(start.lat, start.lon, east.lat, east.lon);
    expect(dNorth).toBeCloseTo(1.11, 1);
    expect(dEast).toBeCloseTo(dNorth, 2);
  });

  it("moves a multi-selection rigidly and leaves the rest alone", () => {
    const wps: Waypoint[] = [
      { id: "a", lat: 59.9, lon: 10, alt: 50 },
      { id: "b", lat: 60.1, lon: 10.2, alt: 50 },
      { id: "c", lat: 60, lon: 11, alt: 50 },
    ];
    const out = nudgeWaypoints(wps, ["a", "b"], 0, 1e-4);
    expect(out[0].lon - wps[0].lon).toBeCloseTo(out[1].lon - wps[1].lon, 12);
    expect(out[2]).toBe(wps[2]);
  });
});

describe("pasteWaypoints", () => {
  const a: Waypoint = { id: "a", lat: 1, lon: 2, alt: 50, groundElevation: 300 };
  const b: Waypoint = {
    id: "b", lat: 1.001, lon: 2, alt: 50,
    actions: [{ id: "j", command: "DO_JUMP", jumpTargetId: "a", param2: 2 }],
  };
  const outside: Waypoint = {
    id: "c", lat: 1.002, lon: 2, alt: 50,
    actions: [
      { id: "j2", command: "DO_JUMP", jumpTargetId: "zz", param2: 1 },
      { id: "s", command: "DO_SET_SPEED", param2: 4 },
    ],
  };

  it("points a jump into the pasted set at the copy of its target", () => {
    const { waypoints, droppedJumps } = pasteWaypoints([a, b]);
    expect(droppedJumps).toBe(0);
    const [copyA, copyB] = waypoints;
    expect(copyA.id).not.toBe("a");
    expect(copyB.id).not.toBe("b");
    const jump = copyB.actions?.[0];
    expect(jump?.command === "DO_JUMP" ? jump.jumpTargetId : undefined).toBe(copyA.id);
    expect(jump?.id).not.toBe("j");
    // Offset copy, terrain sample dropped.
    expect(copyA.lat).toBeCloseTo(1.0002);
    expect(copyA.groundElevation).toBeUndefined();
  });

  it("drops a jump whose target was not copied and counts it", () => {
    const { waypoints, droppedJumps } = pasteWaypoints([outside]);
    expect(droppedJumps).toBe(1);
    expect(waypoints[0].actions?.map((x) => x.command)).toEqual(["DO_SET_SPEED"]);
  });
});
