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
