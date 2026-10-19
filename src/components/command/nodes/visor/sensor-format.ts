/**
 * @module visor/sensor-format
 * @description Pure readings → display helpers shared by the Visor Overview
 * and Sensors tabs.
 * @license GPL-3.0-only
 */

import type { RigSensor, SensorsGnssSummary } from "@/lib/api/agent/sensors";

/** How a live rate compares with the rate the rig expects. `idle` is a sensor
 * that is not expected to deliver right now, drawn neutral; `none` is a sensor
 * whose expected rate the node does not know, so no verdict is drawn. */
export type RateLevel = "ok" | "warn" | "bad" | "idle" | "none";

/** Rates draw amber below 90 % of expected and red below 50 %. An unknown
 * expected rate (null) gives no verdict. A sensor expected at 0 Hz is judged
 * only on whether it delivers at all, and a silent one is idle rather than
 * failing. */
export function rateLevel(rateHz: number, expectedHz: number | null): RateLevel {
  if (expectedHz === null) return "none";
  if (!(expectedHz > 0)) return rateHz > 0 ? "ok" : "idle";
  const ratio = rateHz / expectedHz;
  if (ratio < 0.5) return "bad";
  if (ratio < 0.9) return "warn";
  return "ok";
}

/** A GNSS receiver with no fix (indoors, or before first fix) delivers no
 * solutions, and that is the expected state, not a failing sensor. */
export function gnssWithoutFix(sensor: RigSensor, gnss: SensorsGnssSummary | null): boolean {
  return sensor.kind === "gnss" && (gnss === null || gnss.fix === "none");
}

/** Token classes per level, shared by every Visor reading. */
export const LEVEL_TEXT: Record<RateLevel, string> = {
  ok: "text-status-success",
  warn: "text-status-warning",
  bad: "text-status-error",
  idle: "text-text-tertiary",
  none: "text-text-secondary",
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

const BINARY_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

/** A byte count in binary units, labelled as such (931 GiB, not "931 GB"). */
export function formatBinaryBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BINARY_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${BINARY_UNITS[unit]}`;
}