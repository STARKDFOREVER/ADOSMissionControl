import { describe, it, expect } from "vitest";
import type { Waypoint } from "@/lib/types";
import { deratedPack, estimatePlanEnergy, tempDerate, windDerate } from "@/lib/energy-model";
import { computeFlightPlan } from "@/lib/flight-plan";
import type { BatteryProfile } from "@/lib/energy/battery-split";

const PACK: BatteryProfile = {
  id: "p", name: "Test pack", capacityWh: 100, cruisePowerW: 180, hoverPowerW: 360, reservePct: 20,
};
const HOME = { lat: 12.9716, lon: 77.5946 };
const north = (m: number) => ({ lat: HOME.lat + m / 111_195, lon: HOME.lon });

describe("estimatePlanEnergy", () => {
  // TAKEOFF to 30 m (12 s climb), a 1 km leg at 10 m/s with a 60 s hold at its
  // start, then RTL: the hover time is the climb, the hold, the RTL loiter and
  // the descent; the rest is cruise.
  const mission: Waypoint[] = [
    { id: "t", ...HOME, alt: 30, command: "TAKEOFF" },
    { id: "a", ...north(10), alt: 30, holdTime: 60 },
    { id: "b", ...north(1010), alt: 30 },
    { id: "r", ...north(1010), alt: 0, command: "RTL" },
  ];

  it("takes its time from the flight plan, hover-class time at hover power", () => {
    const plan = computeFlightPlan(mission, 10, { home: HOME });
    const est = estimatePlanEnergy(plan, mission, PACK)!;
    expect(est.hoverSeconds + est.cruiseSeconds).toBeCloseTo(plan.totalDuration, 6);
    expect(est.hoverSeconds).toBeCloseTo(plan.hoverDuration, 6);
    expect(est.hoverSeconds).toBeGreaterThanOrEqual(60 + 12);
    expect(est.totalWh).toBeCloseTo((est.hoverSeconds * 360 + est.cruiseSeconds * 180) / 3600, 6);
    expect(est.flightMinutes).toBeCloseTo(plan.totalDuration / 60, 6);
    expect(est.usablePerPackWh).toBeCloseTo(80, 6);
    expect(est.packs.length).toBe(1);
  });

  it("raises cruise power for wind and cuts capacity for cold", () => {
    const plan = computeFlightPlan(mission, 10, { home: HOME });
    const still = estimatePlanEnergy(plan, mission, PACK)!;
    const windy = estimatePlanEnergy(plan, mission, PACK, { windMps: 5 })!;
    const cold = estimatePlanEnergy(plan, mission, PACK, { tempC: 5 })!;
    expect(windy.cruiseWh).toBeCloseTo(still.cruiseWh * 1.15, 6);
    expect(windy.hoverWh).toBeCloseTo(still.hoverWh, 6);
    expect(cold.usablePerPackWh).toBeCloseTo(80 * 0.8, 6);
  });

  it("is null for a plan with no flight", () => {
    const plan = computeFlightPlan([{ id: "a", ...HOME, alt: 0 }], 10, { home: HOME });
    expect(estimatePlanEnergy(plan, [], PACK)).toBeNull();
  });
});

describe("deratedPack", () => {
  it("leaves the pack unchanged without a forecast", () => {
    expect(deratedPack(PACK, { windMps: null, tempC: null })).toEqual(PACK);
  });
});

describe("windDerate", () => {
  it("raises power for a headwind", () => {
    expect(windDerate(200, 5, true)).toBeCloseTo(230, 6);
    expect(windDerate(200, 5, true)).toBeGreaterThan(200);
  });

  it("lowers power for a tailwind", () => {
    expect(windDerate(200, 5, false)).toBeCloseTo(170, 6);
    expect(windDerate(200, 5, false)).toBeLessThan(200);
  });

  it("leaves power unchanged in still air", () => {
    expect(windDerate(200, 0, true)).toBe(200);
    expect(windDerate(200, 0, false)).toBe(200);
  });

  it("defaults to treating wind as a headwind", () => {
    expect(windDerate(200, 5)).toBeCloseTo(230, 6);
  });

  it("floors a strong tailwind above zero power", () => {
    // 3% per m/s * 100 m/s would go negative; the floor holds it at 50%.
    expect(windDerate(200, 100, false)).toBeCloseTo(100, 6);
  });
});

describe("tempDerate", () => {
  it("returns rated capacity at the nominal temperature", () => {
    expect(tempDerate(100, 25)).toBeCloseTo(100, 6);
  });

  it("loses capacity in the cold", () => {
    // 20 C below nominal at 1% per C = -20%.
    expect(tempDerate(100, 5)).toBeCloseTo(80, 6);
    expect(tempDerate(100, 5)).toBeLessThan(100);
  });

  it("loses a little capacity in the heat", () => {
    // 20 C above nominal at 0.5% per C = -10%.
    expect(tempDerate(100, 45)).toBeCloseTo(90, 6);
    expect(tempDerate(100, 45)).toBeLessThan(100);
  });

  it("floors usable capacity at extreme cold", () => {
    expect(tempDerate(100, -80)).toBeCloseTo(40, 6);
  });
});
