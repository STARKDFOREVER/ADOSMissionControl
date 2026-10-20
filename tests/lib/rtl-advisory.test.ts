import { describe, it, expect } from "vitest";
import {
  checkRtlTerrainClearance,
  type RtlHomePoint,
} from "@/lib/terrain/rtl-advisory";
import { DEFAULT_MIN_TERRAIN_CLEARANCE } from "@/lib/terrain/terrain-clearance";
import type { Waypoint } from "@/lib/types";

/** Build a minimal waypoint with an optional ground elevation. */
function wp(
  id: string,
  lat: number,
  lon: number,
  groundElevation?: number,
): Waypoint {
  return { id, lat, lon, alt: 60, groundElevation };
}

// Home at the equator/prime-meridian, terrain 100 m MSL beneath it.
const HOME: RtlHomePoint = { lat: 0, lon: 0, groundElevation: 100 };
// ~10 km due north of home (0.09 deg latitude ~= 10 km).
const NORTH_10KM = { lat: 0.09, lon: 0 };

describe("checkRtlTerrainClearance", () => {
  it("returns no issues when the RTL cruise clears terrain everywhere", () => {
    // rtlAlt 50 -> cruise 150 m MSL; terrain 100 m -> 50 m clearance.
    const wps = [wp("a", NORTH_10KM.lat, NORTH_10KM.lon, 100)];
    expect(checkRtlTerrainClearance(wps, HOME, 50)).toEqual([]);
  });

  it("raises an error when the return cruise sits below the terrain a leg overflies", () => {
    // rtlAlt 50 -> cruise 150; a 200 m ridge under the waypoint -> below terrain.
    const wps = [wp("a", NORTH_10KM.lat, NORTH_10KM.lon, 200)];
    const issues = checkRtlTerrainClearance(wps, HOME, 50);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("error");
    expect(issues[0].waypointIndex).toBe(0);
    expect(issues[0].distanceKm).toBe(10);
    // 150 m cruise is 50 m below the 200 m terrain.
    expect(issues[0].message).toContain("150 m MSL");
    expect(issues[0].message).toContain("50 m below");
    expect(issues[0].message).toContain("200 m");
    expect(issues[0].message).toContain("WP1");
  });

  it("raises a warning when the cruise clears terrain but by less than the buffer", () => {
    // cruise 150; terrain 148 -> 2 m clearance, below the 5 m minimum -> warn.
    const wps = [wp("a", NORTH_10KM.lat, NORTH_10KM.lon, 148)];
    const issues = checkRtlTerrainClearance(wps, HOME, 50);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warn");
    expect(issues[0].message).toContain("only 2 m");
    expect(issues[0].message).toContain("WP1");
  });

  it("uses DEFAULT_MIN_TERRAIN_CLEARANCE and honours a custom clearance", () => {
    // 3 m clearance: breaches the default 5 m floor but not a custom 1 m floor.
    expect(DEFAULT_MIN_TERRAIN_CLEARANCE).toBe(5);
    const wps = [wp("a", NORTH_10KM.lat, NORTH_10KM.lon, 147)];
    const withDefault = checkRtlTerrainClearance(wps, HOME, 50);
    expect(withDefault).toHaveLength(1);
    expect(withDefault[0].level).toBe("warn");
    const withLoose = checkRtlTerrainClearance(wps, HOME, 50, 1);
    expect(withLoose).toEqual([]);
  });

  it("skips waypoints without a ground-elevation sample", () => {
    const wps = [
      wp("a", NORTH_10KM.lat, NORTH_10KM.lon), // no groundElevation
      wp("b", 0.05, 0, 300), // high ridge -> error
    ];
    const issues = checkRtlTerrainClearance(wps, HOME, 50);
    expect(issues).toHaveLength(1);
    expect(issues[0].waypointIndex).toBe(1);
    expect(issues[0].message).toContain("WP2");
  });

  it("orders errors before warnings, then by severity", () => {
    const wps = [
      wp("warn", 0.05, 0, 148), // 2 m clearance -> warn
      wp("err", NORTH_10KM.lat, NORTH_10KM.lon, 200), // below terrain -> error
    ];
    const issues = checkRtlTerrainClearance(wps, HOME, 50);
    expect(issues).toHaveLength(2);
    expect(issues[0].level).toBe("error");
    expect(issues[1].level).toBe("warn");
  });

  it("returns no issues for an empty mission", () => {
    expect(checkRtlTerrainClearance([], HOME, 50)).toEqual([]);
  });

  it("returns no issues when home elevation is unknown", () => {
    const badHome: RtlHomePoint = { lat: 0, lon: 0, groundElevation: NaN };
    const wps = [wp("a", NORTH_10KM.lat, NORTH_10KM.lon, 300)];
    expect(checkRtlTerrainClearance(wps, badHome, 50)).toEqual([]);
  });

  it("returns no issues when the RTL altitude is not a finite number", () => {
    const wps = [wp("a", NORTH_10KM.lat, NORTH_10KM.lon, 300)];
    expect(checkRtlTerrainClearance(wps, HOME, Number.NaN)).toEqual([]);
  });

  it("flags a low RTL altitude that fails to clear home-area terrain", () => {
    // rtlAlt 0 -> cruise sits at home terrain (100 m); a waypoint over 130 m
    // terrain is 30 m above the cruise path on the way back.
    const wps = [wp("a", NORTH_10KM.lat, NORTH_10KM.lon, 130)];
    const issues = checkRtlTerrainClearance(wps, HOME, 0);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("error");
    expect(issues[0].message).toContain("30 m below");
  });
});

describe("checkRtlTerrainClearance return point and altitude", () => {
  it("checks the leg to the rally point the autopilot picks and names it", () => {
    // A 200 m ridge under the waypoint; the copter returns to a rally point
    // 200 m away (inside RALLY_LIMIT_KM 0.3, closer than home) on 200 m ground.
    const wps = [wp("a", NORTH_10KM.lat, NORTH_10KM.lon, 200)];
    const rally = [{ lat: NORTH_10KM.lat + 0.0018, lon: 0, groundElevation: 200 }];
    const issues = checkRtlTerrainClearance(wps, HOME, 50, DEFAULT_MIN_TERRAIN_CLEARANCE, {
      rally,
      rules: { autopilot: "ardupilot", vehicleClass: "copter" },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].target).toMatchObject({ kind: "rally", rallyIndex: 0 });
    expect(issues[0].distanceKm).toBe(0.2);
    expect(issues[0].message).toContain("return to rally point 1");
    expect(issues[0].message).toContain("direct leg to rally point 1");
  });

  it("returns home when the rally point is beyond Copter's rally limit", () => {
    const wps = [wp("a", NORTH_10KM.lat, NORTH_10KM.lon, 200)];
    const rally = [{ lat: NORTH_10KM.lat + 0.01, lon: 0, groundElevation: 200 }];
    const issues = checkRtlTerrainClearance(wps, HOME, 50, DEFAULT_MIN_TERRAIN_CLEARANCE, {
      rally,
      rules: { autopilot: "ardupilot", vehicleClass: "copter" },
    });
    expect(issues[0].target.kind).toBe("home");
    expect(issues[0].message).toContain("return to home");
  });

  it("checks at the fence-capped return altitude", () => {
    // RTL 120 m but the fence ceiling is 98 m: cruise 198 m MSL, below a 200 m ridge.
    const wps = [wp("a", NORTH_10KM.lat, NORTH_10KM.lon, 200)];
    expect(checkRtlTerrainClearance(wps, HOME, 120)[0]?.level).not.toBe("error");
    const capped = checkRtlTerrainClearance(wps, HOME, 120, DEFAULT_MIN_TERRAIN_CLEARANCE, { ceilingM: 98 });
    expect(capped[0].level).toBe("error");
    expect(capped[0].message).toContain("198 m MSL");
  });
});
