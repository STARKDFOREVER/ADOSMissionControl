/**
 * @module visor/sensor-format
 * @description Pure readings → display helpers shared by the Visor Overview
 * and Sensors tabs.
 * @license GPL-3.0-only
 */

/** How a live rate compares with the rate the rig expects. */
export type RateLevel = "ok" | "warn" | "bad";

/** Rates draw amber below 90 % of expected and red below 50 %. A sensor with
 * no expected rate is judged only on whether it delivers at all. */
export function rateLevel(rateHz: number, expectedHz: number): RateLevel {
  if (expectedHz <= 0) return rateHz > 0 ? "ok" : "bad";
  const ratio = rateHz / expectedHz;
  if (ratio < 0.5) return "bad";
  if (ratio < 0.9) return "warn";
  return "ok";
}

/** Token classes per level, shared by every Visor reading. */
export const LEVEL_TEXT: Record<RateLevel, string> = {
  ok: "text-status-success",
  warn: "text-status-warning",
  bad: "text-status-error",
};

/** A sync sigma in milliseconds, or null when the node reports it unmeasured
 * (negative). */
export function sigmaMs(sigmaNs: number): string | null {
  return sigmaNs < 0 ? null : (sigmaNs / 1e6).toFixed(2);
}

/** A rate for the table: whole numbers at or above 100 Hz, one decimal below. */
export function formatHz(hz: number): string {
  return hz >= 100 ? hz.toFixed(0) : hz.toFixed(1);
}
