/**
 * @module use-planner-flight-plan
 * @description The open plan's flight plan and energy estimate, for every
 * planner surface that draws or reports them (dock statistics, the energy tab,
 * the implicit-leg and battery-change map layers), so they all describe one
 * computation of the same waypoints, speed, home and battery pack.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { computeFlightPlan } from "@/lib/flight-plan";
import { estimatePlanEnergy, type PlanEnergyEstimate } from "@/lib/energy-model";
import type { FlightPlan } from "@/lib/simulation-utils";
import type { BatteryProfile } from "@/lib/energy/battery-split";
import { useFlightPlanOptions } from "@/hooks/use-rtl-return-context";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_BATTERY_PROFILE } from "@/stores/settings/planning-slice";
import { useSiteWeatherStore } from "@/stores/site-weather-store";

/** The flight plan of the open plan's waypoints at the planner default speed. */
export function usePlannerFlightPlan(): FlightPlan {
  const waypoints = useMissionStore((s) => s.waypoints);
  const defaultSpeed = usePlannerStore((s) => s.defaultSpeed);
  const options = useFlightPlanOptions();
  return useMemo(
    () => computeFlightPlan(waypoints, defaultSpeed, options),
    [waypoints, defaultSpeed, options],
  );
}

/** The selected battery pack, falling back to the default pack. */
export function useSelectedBatteryPack(): BatteryProfile {
  const packs = useSettingsStore((s) => s.batteryProfiles);
  const selectedId = useSettingsStore((s) => s.selectedBatteryProfileId);
  return packs.find((p) => p.id === selectedId) ?? DEFAULT_BATTERY_PROFILE;
}

/** What {@link usePlanEnergy} returns. */
export interface PlanEnergy {
  plan: FlightPlan;
  pack: BatteryProfile;
  /** `null` when the plan has nothing to fly. */
  energy: PlanEnergyEstimate | null;
  /** True when the Site tab's forecast derated the pack. */
  forecastApplied: boolean;
}

/**
 * The open plan's energy estimate with the selected pack, derated for the Site
 * tab's forecast wind and temperature when there is one. `energy.packs` holds
 * the per-pack split (where each pack starts and ends).
 */
export function usePlanEnergy(): PlanEnergy {
  const plan = usePlannerFlightPlan();
  const waypoints = useMissionStore((s) => s.waypoints);
  const pack = useSelectedBatteryPack();
  const forecast = useSiteWeatherStore((s) => s.report);
  const windMps = forecast?.windSpeedMps ?? null;
  const tempC = forecast?.temperatureC ?? null;
  return useMemo(
    () => ({
      plan,
      pack,
      energy: estimatePlanEnergy(plan, waypoints, pack, { windMps, tempC }),
      forecastApplied: windMps !== null || tempC !== null,
    }),
    [plan, waypoints, pack, windMps, tempC],
  );
}
