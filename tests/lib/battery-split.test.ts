import { describe, expect, it } from "vitest";
import type { Waypoint } from "@/lib/types";
import { computeFlightPlan } from "@/lib/flight-plan";
import { splitByBattery, type BatteryProfile } from "@/lib/energy/battery-split";
import { haversineDistance } from "@/lib/geo/distance";

const HOME = { lat: 12.9716, lon: 77.5946 };
const north = (m: number) => ({ lat: HOME.lat + m / 111_195, lon: HOME.lon });

/** A pack drawing 360 W in cruise (0.1 Wh per second) and hovering at the same power. */
const pack = (capacityWh: number): BatteryProfile => ({
  id: "p", name: "Pack", capacityWh, cruisePowerW: 360, hoverPowerW: 360, reservePct: 0,
});

// Out along a line of waypoints 1 km apart at 10 m/s (100 s, 10 Wh per leg), then RTL.
const line: Waypoint[] = [
  { id: "t", ...HOME, alt: 0, command: "TAKEOFF" },
  ...[1, 2, 3, 4, 5, 6].map((k) => ({ id: `w${k}`, ...north(k * 1000), alt: 0 })),
  { id: "r", ...north(6000), alt: 0, command: "RTL" },
];

describe("splitByBattery", () => {
  it("returns nothing for an empty plan", () => {
    expect(splitByBattery(computeFlightPlan([], 10), [], pack(100), HOME)).toEqual([]);
  });

  it("fits the whole plan on one large pack", () => {
    const plan = computeFlightPlan(line, 10, { home: HOME, vehicleClass: "rover" });
    const packs = splitByBattery(plan, line, pack(1000), HOME);
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({ fromIndex: 0, toIndex: 7 });
    expect(packs[0].durationS).toBeCloseTo(plan.totalDuration, 6);
  });

  it("ends a pack at the last waypoint it can still fly home from within the usable capacity", () => {
    const plan = computeFlightPlan(line, 10, { home: HOME, vehicleClass: "rover" });
    // 45 Wh usable: reaching WP k costs 10k Wh and flying home 10k Wh more, so
    // the first pack ends at w2 (40 Wh); w3 would need 60 Wh.
    const packs = splitByBattery(plan, line, pack(45), HOME);
    expect(packs[0]).toMatchObject({ fromIndex: 0, toIndex: 2 });
    expect(packs[0].energyWh).toBeCloseTo(40, 3);
    // The next pack starts at the following waypoint.
    expect(packs[1].fromIndex).toBe(3);
    const last = packs[packs.length - 1];
    expect(last.toIndex).toBe(7);
    // Every flown waypoint belongs to exactly one pack, in order.
    for (let i = 1; i < packs.length; i++) expect(packs[i].fromIndex).toBe(packs[i - 1].toIndex + 1);
  });

  it("counts the next pack's flight out to where the previous one stopped", () => {
    const plan = computeFlightPlan(line, 10, { home: HOME, vehicleClass: "rover" });
    const packs = splitByBattery(plan, line, pack(45), HOME);
    // Pack 2 flies home → w2 (2 km), on to w3 (1 km) and home (3 km): 60 Wh,
    // over the 45 Wh usable, so a waypoint no pack reaches safely still gets its own pack.
    expect(packs[1]).toMatchObject({ fromIndex: 3, toIndex: 3 });
    const outAndBack = 2 * haversineDistance(HOME.lat, HOME.lon, north(3000).lat, north(3000).lon) / 10 * 0.1;
    expect(packs[1].energyWh).toBeCloseTo(outAndBack, 3);
  });
});
