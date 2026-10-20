/**
 * Named-settings and text-CLI settings capability surfaces.
 *
 * @license GPL-3.0-only
 */

import type { CommandResult } from './core';
import type { SettingInfo, SettingValue } from '../msp/settings';

/**
 * Name-indexed FC settings surface (the iNav MSP2_COMMON_SETTING family).
 *
 * Present only on firmwares that expose name-addressed settings (iNav).
 * MAVLink firmwares (ArduPilot, PX4) leave `DroneProtocol.settings`
 * undefined — they configure through the numeric parameter surface instead.
 */
export interface SettingsCapability {
  /** Read a named setting, decoded into its typed value. */
  getSetting(name: string): Promise<SettingValue>;
  /** Write a named setting from a typed value. */
  setSetting(name: string, value: number | string): Promise<CommandResult>;
  /** Fetch metadata (type, range, enum labels, current value) for a named setting. */
  getSettingInfo(name: string): Promise<SettingInfo>;
  /** Enumerate every named setting the FC exposes. */
  enumerate(): Promise<SettingInfo[]>;
}

/** One firmware setting read from the CLI: name + raw text value. */
export interface CliSetting {
  name: string;
  value: string;
}

/** A staged CLI setting change (name + new raw text value). */
export interface CliSettingChange {
  name: string;
  value: string;
}

/**
 * Text-CLI settings surface (the Betaflight `#` CLI: `get` / `set` / `dump` /
 * `save`). Present only on firmwares that expose their full settings solely
 * through the CLI because they have no name-based introspection protocol
 * (Betaflight). iNav uses the typed `settings` capability instead; MAVLink
 * firmwares leave both undefined.
 */
export interface CliSettingsCapability {
  /** Enter the CLI, `dump` every setting's current value, exit (no reboot). */
  enumerate(): Promise<CliSetting[]>;
  /** Read one setting's current value (`get <name>`). */
  getSetting(name: string): Promise<string | undefined>;
  /**
   * Apply staged changes in one CLI session (`set name = value`). Persists to
   * EEPROM via `save noreboot` when `persist` is set; neither path reboots.
   */
  applySettings(changes: CliSettingChange[], opts?: { persist?: boolean }): Promise<CommandResult>;
}
