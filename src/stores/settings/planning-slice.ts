/**
 * Mission-planning slice for the persisted settings store: the camera
 * profiles the operator added for survey and inspection patterns, and the
 * battery packs the energy estimate and battery split fly with.
 *
 * @license GPL-3.0-only
 */

import type { BatteryProfile } from "@/lib/energy/battery-split";
import type { SettingsSliceFactory, SettingsStoreState } from "./types";

/** Id of the pack every install starts with; it cannot be removed. */
export const DEFAULT_BATTERY_PROFILE_ID = "default";

/**
 * The pack every install starts with: a ~2 kg class multirotor on a 6S Li-ion
 * class pack. First-order planning figures, not a measured power curve.
 */
export const DEFAULT_BATTERY_PROFILE: Readonly<BatteryProfile> = Object.freeze({
  id: DEFAULT_BATTERY_PROFILE_ID,
  name: "Default pack",
  capacityWh: 185,
  cruisePowerW: 180,
  hoverPowerW: 220,
  reservePct: 20,
});

/** A fresh, mutable copy of the default pack list. */
export function defaultBatteryProfiles(): BatteryProfile[] {
  return [{ ...DEFAULT_BATTERY_PROFILE }];
}

export const planningDefaults: Partial<SettingsStoreState> = {
  customCameras: [],
  batteryProfiles: defaultBatteryProfiles(),
  selectedBatteryProfileId: DEFAULT_BATTERY_PROFILE_ID,
};

export const createPlanningActions: SettingsSliceFactory<
  Pick<
    SettingsStoreState,
    | "addCustomCamera"
    | "updateCustomCamera"
    | "removeCustomCamera"
    | "addBatteryProfile"
    | "updateBatteryProfile"
    | "removeBatteryProfile"
    | "selectBatteryProfile"
  >
> = (set) => ({
  addCustomCamera: (camera) =>
    set((s) => ({ customCameras: [...s.customCameras.filter((c) => c.name !== camera.name), camera] })),
  updateCustomCamera: (name, camera) =>
    set((s) => ({
      customCameras: s.customCameras
        .filter((c) => c.name === name || c.name !== camera.name)
        .map((c) => (c.name === name ? camera : c)),
    })),
  removeCustomCamera: (name) =>
    set((s) => ({ customCameras: s.customCameras.filter((c) => c.name !== name) })),

  addBatteryProfile: (profile) =>
    set((s) => ({ batteryProfiles: [...s.batteryProfiles.filter((p) => p.id !== profile.id), profile] })),
  updateBatteryProfile: (id, update) =>
    set((s) => ({
      batteryProfiles: s.batteryProfiles.map((p) => (p.id === id ? { ...p, ...update, id } : p)),
    })),
  removeBatteryProfile: (id) =>
    set((s) => {
      if (id === DEFAULT_BATTERY_PROFILE_ID) return {};
      return {
        batteryProfiles: s.batteryProfiles.filter((p) => p.id !== id),
        // Removing the selected pack falls back to the default one.
        ...(s.selectedBatteryProfileId === id ? { selectedBatteryProfileId: DEFAULT_BATTERY_PROFILE_ID } : {}),
      };
    }),
  selectBatteryProfile: (id) =>
    set((s) => (s.batteryProfiles.some((p) => p.id === id) ? { selectedBatteryProfileId: id } : {})),
});
