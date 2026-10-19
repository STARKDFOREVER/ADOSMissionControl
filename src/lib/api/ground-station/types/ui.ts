/**
 * @module api/ground-station/types/ui
 * @description Physical UI types: OLED panel config, button bindings,
 * screen rotation, HDMI display, Bluetooth devices and gamepads.
 *
 * @license GPL-3.0-only
 */

export interface OledConfig {
  brightness: number;
}

/** The front-panel button ids, in panel order. Each has a short- and a
 * long-press binding keyed `<id>_short` / `<id>_long`. */
export const PANEL_BUTTONS = ["B1", "B2", "B3", "B4"] as const;

/** The actions a front-panel press can be bound to. `passthrough` delivers
 * the press only to plugins subscribed to it (the capture plugin's REC and
 * MARK); `shutdown_prompt` opens the power-off confirmation on the panel. */
export const PANEL_BUTTON_ACTIONS = [
  "cycle_screen",
  "back",
  "confirm",
  "menu",
  "show_network",
  "show_qr",
  "pair_drone",
  "toggle_backlight",
  "passthrough",
  "shutdown_prompt",
] as const;
export type PanelButtonAction = (typeof PANEL_BUTTON_ACTIONS)[number];

/** The agent profiles (wire spelling) that carry a front panel. */
export type PanelProfile = "ground_station" | "visor";

/** The agent's built-in button mapping per panel profile (mirrors
 * `ados_protocol::panel_ui::{GROUND_STATION_BUTTONS, VISOR_BUTTONS}`). A
 * stored mapping is merged over these, so a write carries only the presses
 * that differ and a later change to a default still reaches the node. */
export const PANEL_BUTTON_DEFAULTS: Record<PanelProfile, Record<string, PanelButtonAction>> = {
  ground_station: {
    B1_short: "cycle_screen",
    B1_long: "toggle_backlight",
    B2_short: "show_network",
    B2_long: "show_qr",
    B3_short: "confirm",
    B3_long: "pair_drone",
    B4_short: "back",
    B4_long: "menu",
  },
  visor: {
    B1_short: "passthrough",
    B1_long: "shutdown_prompt",
    B2_short: "passthrough",
    B2_long: "passthrough",
    B3_short: "cycle_screen",
    B3_long: "passthrough",
    B4_short: "back",
    B4_long: "passthrough",
  },
};

/** The agent's default screen order per panel profile (also the default
 * enabled set; mirrors `panel_ui::{GROUND_STATION_SCREENS, VISOR_SCREENS}`). */
export const PANEL_SCREEN_DEFAULTS: Record<PanelProfile, readonly string[]> = {
  ground_station: ["home", "link", "drone", "network", "system", "qr", "gnss", "radios", "lora"],
  visor: ["plugin:capture_hud", "cameras", "sensors", "storage", "about"],
};

/** The presses of `mapping` that differ from the profile defaults: the body
 * of a buttons write. */
export function buttonOverrides(
  mapping: Record<string, string>,
  profile: PanelProfile,
): Record<string, string> {
  const defaults: Record<string, string> = PANEL_BUTTON_DEFAULTS[profile];
  return Object.fromEntries(Object.entries(mapping).filter(([k, v]) => defaults[k] !== v));
}

export interface ButtonsConfig {
  /** `B<n>_short` / `B<n>_long` → action name, merged over the profile's
   * defaults by the agent. */
  mapping: Record<string, string>;
}

export interface ScreensConfig {
  order: string[];
  enabled: string[];
}

export interface UiConfig {
  oled: OledConfig;
  buttons: ButtonsConfig;
  screens: ScreensConfig;
}

export interface OledUpdate {
  brightness?: number;
}

export interface ScreensUpdate {
  order?: string[];
  enabled?: string[];
}

// Display
export interface DisplayConfig {
  resolution: string;
  kiosk_enabled: boolean;
}

export interface DisplayUpdate {
  resolution?: string;
  kiosk_enabled?: boolean;
}

// Bluetooth
export interface BluetoothDevice {
  mac: string;
  name: string;
  rssi_dbm?: number | null;
  paired?: boolean;
  /** Measured per device; null when bluetoothctl did not answer (unknown,
   * never "disconnected"). */
  connected?: boolean | null;
}

export interface BluetoothScanResult {
  devices: BluetoothDevice[];
}

export interface BluetoothPairResult {
  paired: boolean;
  mac: string;
  name?: string | null;
}

export interface BluetoothForgetResult {
  forgotten: boolean;
  mac: string;
}

export interface BluetoothPairedList {
  devices: BluetoothDevice[];
}

// Gamepads
export interface Gamepad {
  device_id: string;
  name: string;
  type: "usb" | "bluetooth" | "unknown";
  connected: boolean;
  is_primary?: boolean;
}

export interface GamepadList {
  devices: Gamepad[];
  primary_id: string | null;
}

export interface GamepadPrimaryUpdate {
  primary_id: string | null;
}
