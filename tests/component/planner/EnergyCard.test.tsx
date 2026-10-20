/**
 * Render tests for EnergyCard. The card takes its time from the same flight
 * plan as the dock statistics (holds and climbs at hover power), its power and
 * capacity from the selected battery profile, its derates from the site
 * forecast, and shows an honest em-dash for every figure when there is no flight.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Waypoint } from "@/lib/types";
import type { BatteryProfile } from "@/lib/energy/battery-split";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/hooks/use-rtl-return-context", () => ({ useFlightPlanOptions: () => planOptions }));
const settings = vi.hoisted(() => ({
  batteryProfiles: [] as BatteryProfile[],
  selectedBatteryProfileId: "default",
}));
vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: (sel: (s: typeof settings) => unknown) => sel(settings),
}));

import { EnergyCard } from "@/components/planner/EnergyCard";
import { useSiteWeatherStore } from "@/stores/site-weather-store";
import { computeFlightPlan } from "@/lib/flight-plan";
import { estimatePlanEnergy } from "@/lib/energy-model";

const HOME = { lat: 12.9716, lon: 77.5946 };
const planOptions = { home: HOME };
const north = (m: number) => ({ lat: HOME.lat + m / 111_195, lon: HOME.lon });

const SMALL: BatteryProfile = { id: "small", name: "Small", capacityWh: 50, cruisePowerW: 200, hoverPowerW: 250, reservePct: 20 };
const BIG: BatteryProfile = { id: "big", name: "Big", capacityWh: 5000, cruisePowerW: 400, hoverPowerW: 500, reservePct: 20 };

const mission: Waypoint[] = [
  { id: "t", ...HOME, alt: 30, command: "TAKEOFF" },
  { id: "a", ...north(500), alt: 30, holdTime: 120 },
  { id: "b", ...north(8000), alt: 30 },
  { id: "c", ...north(16000), alt: 30 },
  { id: "r", ...north(16000), alt: 0, command: "RTL" },
];

beforeEach(() => {
  cleanup();
  settings.batteryProfiles = [SMALL, BIG];
  settings.selectedBatteryProfileId = "big";
  useSiteWeatherStore.setState({ report: null });
});

describe("EnergyCard", () => {
  it("shows the energy of the flight plan on the selected pack, holds and climbs at hover power", () => {
    render(<EnergyCard waypoints={mission} defaultSpeed={10} />);
    const plan = computeFlightPlan(mission, 10, planOptions);
    const est = estimatePlanEnergy(plan, mission, BIG)!;
    expect(screen.getByText(`${Math.round(est.totalWh)} Wh`)).toBeDefined();
    // Not the old distance ÷ speed figure: the 120 s hold and the climbs count.
    expect(est.hoverSeconds).toBeGreaterThan(120);
    expect(screen.getByText("0")).toBeDefined(); // no swap on the big pack
  });

  it("splits the plan across packs of a small profile and lists them", () => {
    settings.selectedBatteryProfileId = "small";
    render(<EnergyCard waypoints={mission} defaultSpeed={10} />);
    expect(screen.getAllByText("packRange").length).toBeGreaterThan(1);
  });

  it("derates for the site forecast's wind", () => {
    const { unmount } = render(<EnergyCard waypoints={mission} defaultSpeed={10} />);
    const still = estimatePlanEnergy(computeFlightPlan(mission, 10, planOptions), mission, BIG)!;
    unmount();
    useSiteWeatherStore.setState({
      report: {
        observedAt: null, windSpeedMps: 8, windGustMps: null, windDirectionDeg: null, temperatureC: null,
        levels: [], forecastPeakGustMps: null, forecastWindowHours: null,
      },
    });
    render(<EnergyCard waypoints={mission} defaultSpeed={10} />);
    const windy = estimatePlanEnergy(computeFlightPlan(mission, 10, planOptions), mission, BIG, { windMps: 8 })!;
    expect(windy.totalWh).toBeGreaterThan(still.totalWh);
    expect(screen.getByText(`${Math.round(windy.totalWh)} Wh`)).toBeDefined();
  });

  it("shows honest em-dashes when there is no flight", () => {
    render(<EnergyCard waypoints={[{ id: "a", ...HOME, alt: 0 }]} defaultSpeed={10} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/Wh/)).toBeNull();
  });
});
