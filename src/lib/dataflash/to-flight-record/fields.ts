import type { DataflashRecord } from "../parser";

/** Convert raw ArduPilot µs ticks into ms relative to a reference. */
export function usToOffsetMs(us: number, refUs: number): number {
  return Math.max(0, Math.round((us - refUs) / 1000));
}

/** Pull a number field from a DataflashRecord, returning undefined when absent. */
export function num(r: DataflashRecord, key: string): number | undefined {
  const v = r[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * True for a row of the first sensor instance. Multi-instance messages (GPS
 * `I`, BAT `Inst`, VIBE `IMU`) log one row per instance; a row without the
 * instance column comes from a single-instance log.
 */
export function isFirstInstance(r: DataflashRecord, key: string): boolean {
  return (num(r, key) ?? 0) === 0;
}
