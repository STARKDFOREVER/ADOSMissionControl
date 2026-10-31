/**
 * @module format
 * @description Display formatting shared by readout tiles.
 * @license GPL-3.0-only
 */

/** Placeholder for a reading that is absent or not a finite number. */
export const NO_READING = "--";

/**
 * `value` to `digits` decimal places followed by `unit`, or `NO_READING`
 * when there is no finite reading.
 */
export function formatOr(value: number | null | undefined, digits: number, unit = ""): string {
  return value == null || !Number.isFinite(value) ? NO_READING : `${value.toFixed(digits)}${unit}`;
}
