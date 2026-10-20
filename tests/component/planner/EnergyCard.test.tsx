/**
 * Render tests for the Energy tab. The card takes its time from the shared
 * flight plan (holds and climbs at hover power), its power and capacity from
 * the selected battery pack, its derates from the site forecast, and shows an
 * honest em-dash for every figure when there is no flight. Picking a pack
 * re-estimates; a later pack's row resumes the plan where that pack takes
 * over; the pack editor never deletes the default pack.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { Waypoint } from "@/lib/types";
import type { BatteryProfile } from "@/lib/energy/battery-split";
import { renderWithIntl } from "../../helpers/intl-wrapper";

vi.mock("@/hooks/use-rtl-return-context", () => ({ useFlightPlanOptions: () => planOptions }));
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import { EnergyCard } from "@/components/planner/EnergyCard";
import { BatteryPacksModal } from "@/components/planner/BatteryPacksModal";
import { packEndFractions } from "@/components/planner/EnergyRouteBar";
import { useSiteWeatherStore } from "@/stores/site-weather-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { DEFAULT_BATTERY_PROFILE } from "@/stores/settings/planning-slice";
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

const estimate = (pack: BatteryProfile, env = {}) =>
  estimatePlanEnergy(computeFlightPlan(mission, 10, planOptions), mission, pack, env)!;

beforeEach(() => {
  cleanup();
  useSettingsStore.setState({
    batteryProfiles: [{ ...DEFAULT_BATTERY_PROFILE }, SMALL, BIG],
    selectedBatteryProfileId: "big",
  });
  useMissionStore.setState({ waypoints: mission });
  usePlannerStore.setState({ defaultSpeed: 10, sendDialog: null });
  useSiteWeatherStore.setState({ report: null });
});

/** Open the Battery select and pick a pack by name. */
function pickPack(name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Battery" }));
  fireEvent.click(screen.getByRole("option", { name }));
}

describe("EnergyCard estimate", () => {
  it("shows the energy of the flight plan on the selected pack, holds and climbs at hover power", () => {
    renderWithIntl(<EnergyCard />);
    const est = estimate(BIG);
    expect(screen.getByText(`${Math.round(est.totalWh)} Wh`)).toBeDefined();
    // Not a distance ÷ speed figure: the 120 s hold and the climbs count.
    expect(est.hoverSeconds).toBeGreaterThan(120);
    expect(screen.getByText("0")).toBeDefined(); // no swap on the big pack
  });

  it("re-estimates when another pack is picked", () => {
    renderWithIntl(<EnergyCard />);
    const big = Math.round(estimate(BIG).totalWh);
    const small = Math.round(estimate(SMALL).totalWh);
    expect(small).not.toBe(big);
    pickPack("Small");
    expect(useSettingsStore.getState().selectedBatteryProfileId).toBe("small");
    expect(screen.getByText(`${small} Wh`)).toBeDefined();
    expect(screen.queryByText(`${big} Wh`)).toBeNull();
    // The small pack splits the plan: one row per pack.
    expect(within(screen.getByRole("list", { name: "Energy and time per pack" })).getAllByRole("listitem").length)
      .toBe(estimate(SMALL).packs.length);
  });

  it("derates for the site forecast's wind", () => {
    useSiteWeatherStore.setState({
      report: {
        observedAt: null, windSpeedMps: 8, windGustMps: null, windDirectionDeg: null, temperatureC: null,
        levels: [], forecastPeakGustMps: null, forecastWindowHours: null,
      },
    });
    renderWithIntl(<EnergyCard />);
    const windy = estimate(BIG, { windMps: 8 });
    expect(windy.totalWh).toBeGreaterThan(estimate(BIG).totalWh);
    expect(screen.getByText(`${Math.round(windy.totalWh)} Wh`)).toBeDefined();
  });

  it("the reserve field edits the selected pack", () => {
    renderWithIntl(<EnergyCard />);
    const reserve = screen.getByLabelText("Reserve") as HTMLInputElement;
    fireEvent.focus(reserve);
    fireEvent.change(reserve, { target: { value: "35" } });
    fireEvent.blur(reserve);
    expect(useSettingsStore.getState().batteryProfiles.find((p) => p.id === "big")?.reservePct).toBe(35);
  });

  it("shows honest em-dashes when there is no flight", () => {
    useMissionStore.setState({ waypoints: [{ id: "a", ...HOME, alt: 0 }] });
    renderWithIntl(<EnergyCard />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/^\d+\+? Wh$/)).toBeNull();
    expect(screen.queryByRole("list", { name: "Energy and time per pack" })).toBeNull();
  });
});

describe("EnergyCard packs and resume", () => {
  it("each later pack's row resumes from the waypoint where it takes over", () => {
    useSettingsStore.setState({ selectedBatteryProfileId: "small" });
    renderWithIntl(<EnergyCard />);
    const packs = estimate(SMALL).packs;
    expect(packs.length).toBeGreaterThan(1);
    // The first pack flies the plan from the start: no resume.
    const rows = within(screen.getByRole("list", { name: "Energy and time per pack" })).getAllByRole("listitem");
    expect(within(rows[0]).queryByRole("button")).toBeNull();
    const second = packs[1];
    fireEvent.click(within(rows[1]).getByRole("button", { name: `Resume from WP ${second.fromIndex + 1}` }));
    expect(usePlannerStore.getState().sendDialog).toEqual({ resumeFromIndex: second.fromIndex });
  });

  it("splits the route bar per pack and ticks each change", () => {
    useSettingsStore.setState({ selectedBatteryProfileId: "small" });
    renderWithIntl(<EnergyCard />);
    const packs = estimate(SMALL).packs;
    expect(screen.getAllByRole("img", { name: /^Pack \d+: WP/ })).toHaveLength(packs.length);
    expect(screen.getByText(`⚡2 WP ${packs[1].fromIndex + 1}`)).toBeDefined();
  });

  it("puts each change tick where the outgoing pack reaches its last waypoint", () => {
    const plan = computeFlightPlan(mission, 10, planOptions);
    const packs = estimate(SMALL).packs;
    const ends = packEndFractions(plan, packs);
    expect(ends[ends.length - 1]).toBe(1);
    for (let k = 1; k < ends.length; k++) expect(ends[k]).toBeGreaterThanOrEqual(ends[k - 1]);
    expect(ends[0]).toBeGreaterThan(0);
    expect(ends[0]).toBeLessThan(1);
  });

  it("Edit packs… opens the pack editor", () => {
    renderWithIntl(<EnergyCard />);
    fireEvent.click(screen.getByRole("button", { name: "Edit packs…" }));
    expect(screen.getByRole("dialog", { name: "Battery packs" })).toBeDefined();
  });
});

describe("BatteryPacksModal", () => {
  it("cannot delete the default pack, and says why", () => {
    renderWithIntl(<BatteryPacksModal open onClose={() => {}} />);
    const del = screen.getByRole("button", { name: "The default pack can't be deleted" });
    expect(del.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(del);
    expect(useSettingsStore.getState().batteryProfiles.some((p) => p.id === "default")).toBe(true);
  });

  it("deletes, renames and adds packs", () => {
    renderWithIntl(<BatteryPacksModal open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Small" }));
    expect(useSettingsStore.getState().batteryProfiles.map((p) => p.id)).toEqual(["default", "big"]);

    const name = screen.getByLabelText("Name of Big") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "6S 22Ah" } });
    fireEvent.blur(name);
    expect(useSettingsStore.getState().batteryProfiles.find((p) => p.id === "big")?.name).toBe("6S 22Ah");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Add pack" }));
    });
    const packs = useSettingsStore.getState().batteryProfiles;
    expect(packs).toHaveLength(3);
    expect(useSettingsStore.getState().selectedBatteryProfileId).toBe(packs[2].id);
    expect(packs[2].name).toBe("Pack 3");
  });

  it("an emptied name reverts", () => {
    renderWithIntl(<BatteryPacksModal open onClose={() => {}} />);
    const name = screen.getByLabelText("Name of Big") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.blur(name);
    expect(name.value).toBe("Big");
    expect(useSettingsStore.getState().batteryProfiles.find((p) => p.id === "big")?.name).toBe("Big");
  });
});
