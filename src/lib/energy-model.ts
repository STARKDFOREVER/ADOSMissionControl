/**
 * @module energy-model
 * @description Simple, transparent flight-energy estimation for mission planning.
 * Estimates watt-hours from the flight plan's own timing (hover-class time at
 * hover power, the rest at cruise power), splits the plan across battery packs
 * with a safety reserve (see `energy/battery-split`), and derates power for wind
 * and battery capacity for temperature.
 *
 * The formulas are deliberately first-order approximations with documented
 * coefficients. They are planning aids, not a substitute for a measured power
 * curve, so no more precision is implied than the inputs justify.
 * @license GPL-3.0-only
 */

import type { FlightPlan } from "@/lib/simulation-utils";
import type { Waypoint } from "@/lib/types";
import { splitByBattery, type BatteryProfile, type BatterySplit } from "@/lib/energy/battery-split";

/** Watt-hours per joule-hour helper: seconds -> hours divisor. */
const SECONDS_PER_HOUR = 3600;

/** Clamp a value to an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Fractional change in cruise power per m/s of wind.
 * ~3% per m/s is a rough headwind/tailwind sensitivity for a small multirotor
 * or fixed-wing at typical cruise; it is a linear stand-in for the real
 * airspeed-vs-power curve.
 */
const WIND_POWER_COEFF = 0.03;

/** A strong tailwind never drives cruise power below this fraction of base. */
const WIND_MIN_FACTOR = 0.5;

/**
 * Derate (or uprate) a base power draw for wind.
 *
 * A headwind forces a higher airspeed to hold ground speed, raising power; a
 * tailwind lowers it. Modeled linearly at {@link WIND_POWER_COEFF} per m/s and
 * floored at {@link WIND_MIN_FACTOR} so a strong tailwind still leaves the power
 * needed to stay aloft.
 *
 * @param baseWatts Still-air power draw, in watts.
 * @param windMps Wind speed magnitude, in m/s. Negative values use their magnitude.
 * @param headwind True for a net headwind (raises power), false for a tailwind.
 * @returns Adjusted power draw, in watts.
 */
export function windDerate(baseWatts: number, windMps: number, headwind = true): number {
  const magnitude = Math.abs(windMps);
  const sign = headwind ? 1 : -1;
  const factor = Math.max(WIND_MIN_FACTOR, 1 + sign * WIND_POWER_COEFF * magnitude);
  return baseWatts * factor;
}

/** Temperature at which battery capacity is considered rated, in degrees Celsius. */
const NOMINAL_TEMP_C = 25;

/** Fractional capacity lost per degree C below {@link NOMINAL_TEMP_C}. */
const COLD_LOSS_PER_C = 0.01;

/** Fractional capacity lost per degree C above {@link NOMINAL_TEMP_C}. */
const HOT_LOSS_PER_C = 0.005;

/** Usable capacity never derates below this fraction of rated. */
const TEMP_MIN_FACTOR = 0.4;

/**
 * Derate usable battery capacity for temperature.
 *
 * Cold is the dominant real effect: lithium packs deliver noticeably less energy
 * below room temperature. Heat causes a milder loss. Modeled piecewise-linearly
 * around {@link NOMINAL_TEMP_C} and floored at {@link TEMP_MIN_FACTOR}.
 *
 * @param capacityWh Rated capacity, in watt-hours.
 * @param tempC Ambient (or pack) temperature, in degrees Celsius.
 * @returns Usable capacity at that temperature, in watt-hours.
 */
export function tempDerate(capacityWh: number, tempC: number): number {
  let factor: number;
  if (tempC < NOMINAL_TEMP_C) {
    factor = 1 - COLD_LOSS_PER_C * (NOMINAL_TEMP_C - tempC);
  } else {
    factor = 1 - HOT_LOSS_PER_C * (tempC - NOMINAL_TEMP_C);
  }
  return capacityWh * clamp(factor, TEMP_MIN_FACTOR, 1);
}

/** Site conditions the estimate derates for; null or absent = not known. */
export interface EnergyEnvironment {
  /** Sustained surface wind, m/s. */
  windMps?: number | null;
  /** Air temperature, degrees Celsius. */
  tempC?: number | null;
}

/**
 * The pack as it flies in `env`: cruise power raised for the wind (taken as a
 * headwind, the conservative case for a route flown in every direction) and
 * capacity lowered for the temperature.
 */
export function deratedPack(pack: BatteryProfile, env: EnergyEnvironment = {}): BatteryProfile {
  const wind = env.windMps ?? 0;
  const temp = env.tempC;
  return {
    ...pack,
    cruisePowerW: wind > 0 ? windDerate(pack.cruisePowerW, wind, true) : pack.cruisePowerW,
    capacityWh: temp !== null && temp !== undefined && Number.isFinite(temp) ? tempDerate(pack.capacityWh, temp) : pack.capacityWh,
  };
}

/** Reserve is clamped below this so at least some capacity is always usable. */
const MAX_RESERVE_FRACTION = 0.99;

/** Result of {@link estimatePlanEnergy}. */
export interface PlanEnergyEstimate {
  /** Energy for the whole flight, watt-hours. */
  totalWh: number;
  /** Energy spent hovering, climbing or holding, watt-hours. */
  hoverWh: number;
  /** Energy spent in forward flight, watt-hours. */
  cruiseWh: number;
  /** Seconds at hover power. */
  hoverSeconds: number;
  /** Seconds at cruise power. */
  cruiseSeconds: number;
  /** Total flight time, minutes. */
  flightMinutes: number;
  /** Usable watt-hours per pack once the reserve is held back, after derating. */
  usablePerPackWh: number;
  /** Where each pack starts and ends; one entry per pack. */
  packs: BatterySplit[];
  /** The pack after the wind and temperature derates. */
  pack: BatteryProfile;
}

/**
 * Energy budget of a computed flight plan flown on `pack` in `env`. Hover-class
 * time (holds, loiters, vertical climbs and descents) draws hover power and
 * the rest cruise power. Null when the plan has no flight.
 */
export function estimatePlanEnergy(
  plan: FlightPlan,
  waypoints: Waypoint[],
  pack: BatteryProfile,
  env: EnergyEnvironment = {},
): PlanEnergyEstimate | null {
  if (plan.segments.length === 0 || plan.totalDuration <= 0 || !plan.home) return null;
  const flown = deratedPack(pack, env);
  const hoverSeconds = Math.min(plan.hoverDuration, plan.totalDuration);
  const cruiseSeconds = plan.totalDuration - hoverSeconds;
  const hoverWh = (hoverSeconds * flown.hoverPowerW) / SECONDS_PER_HOUR;
  const cruiseWh = (cruiseSeconds * flown.cruisePowerW) / SECONDS_PER_HOUR;
  const reserve = clamp(flown.reservePct / 100, 0, MAX_RESERVE_FRACTION);
  return {
    totalWh: hoverWh + cruiseWh,
    hoverWh,
    cruiseWh,
    hoverSeconds,
    cruiseSeconds,
    flightMinutes: plan.totalDuration / 60,
    usablePerPackWh: Math.max(0, flown.capacityWh * (1 - reserve)),
    packs: splitByBattery(plan, waypoints, flown, plan.home),
    pack: flown,
  };
}
