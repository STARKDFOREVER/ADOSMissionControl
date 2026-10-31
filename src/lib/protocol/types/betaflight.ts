/**
 * Betaflight domain types: decoded MSP shapes for LED strip and VTX tables,
 * shared by the decoders, the adapter and the configuration panels.
 *
 * @module protocol/types/betaflight
 */

export interface MspLedStripConfig {
  leds: number[];
}

/** One entry of the 16-colour configurable HSV palette. */
export interface HsvColor {
  h: number; // 0..359
  s: number; // 0..255
  v: number; // 0..255
}

/**
 * One mode-colour assignment: which palette colour a given (mode, function)
 * pair uses. `mode` 0..5 = flight-mode groups (each with 6 direction funcs),
 * `mode` 6 = special-colour group, `mode` 7 = aux-channel selector (its
 * `color` field carries the RC aux channel, not a palette index).
 */
export interface BfLedModeColor {
  mode: number;
  fun: number;
  color: number;
}

export interface MspVtxTablePowerLevel {
  powerNumber: number;
  powerValue: number;
  powerLabel: string;
}
