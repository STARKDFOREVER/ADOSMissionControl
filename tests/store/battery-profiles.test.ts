/**
 * Battery packs in the settings store: an older payload is seeded with the
 * default pack, the default pack cannot be removed, and removing the selected
 * pack falls back to it.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore, migrateSettings } from "@/stores/settings-store";
import {
  DEFAULT_BATTERY_PROFILE,
  DEFAULT_BATTERY_PROFILE_ID,
  defaultBatteryProfiles,
} from "@/stores/settings/planning-slice";

const SPARE = { id: "spare", name: "Spare 6S", capacityWh: 222, cruisePowerW: 190, hoverPowerW: 230, reservePct: 25 };

describe("battery profiles", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      batteryProfiles: defaultBatteryProfiles(),
      selectedBatteryProfileId: DEFAULT_BATTERY_PROFILE_ID,
    });
  });

  it("a payload from before packs existed is seeded with the default pack", () => {
    const migrated = migrateSettings({ customCameras: [] }, 55);
    expect(migrated.batteryProfiles).toEqual([
      { id: "default", name: "Default pack", capacityWh: 185, cruisePowerW: 180, hoverPowerW: 220, reservePct: 20 },
    ]);
    expect(migrated.selectedBatteryProfileId).toBe("default");
  });

  it("migration keeps packs the operator already has", () => {
    const migrated = migrateSettings({ batteryProfiles: [DEFAULT_BATTERY_PROFILE, SPARE], selectedBatteryProfileId: "spare" }, 55);
    expect(migrated.batteryProfiles).toHaveLength(2);
    expect(migrated.selectedBatteryProfileId).toBe("spare");
  });

  it("the default pack cannot be removed", () => {
    useSettingsStore.getState().removeBatteryProfile(DEFAULT_BATTERY_PROFILE_ID);
    expect(useSettingsStore.getState().batteryProfiles.map((p) => p.id)).toEqual(["default"]);
  });

  it("removing the selected pack selects the default one", () => {
    const s = useSettingsStore.getState();
    s.addBatteryProfile(SPARE);
    s.selectBatteryProfile("spare");
    expect(useSettingsStore.getState().selectedBatteryProfileId).toBe("spare");
    useSettingsStore.getState().removeBatteryProfile("spare");
    expect(useSettingsStore.getState().batteryProfiles.map((p) => p.id)).toEqual(["default"]);
    expect(useSettingsStore.getState().selectedBatteryProfileId).toBe("default");
  });

  it("rename and edits keep the pack's id; an unknown id is not selectable", () => {
    const s = useSettingsStore.getState();
    s.updateBatteryProfile("default", { name: "Field pack", reservePct: 30 });
    expect(useSettingsStore.getState().batteryProfiles[0]).toMatchObject({ id: "default", name: "Field pack", reservePct: 30 });
    s.selectBatteryProfile("missing");
    expect(useSettingsStore.getState().selectedBatteryProfileId).toBe("default");
  });
});
