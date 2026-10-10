/**
 * Tooltip chords come from the active loadout: a rebind moves the chord, the
 * arm slot's chord fires disarm, and the pause slot's chord names resume only
 * while a mission is paused.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSkillChord } from "@/lib/skills/use-skill-chord";
import { formatChord } from "@/lib/skills/chord";
import { useSettingsStore } from "@/stores/settings-store";
import { cloneDefaultLoadout, DEFAULT_LOADOUT_ID } from "@/stores/settings/keybindings-slice";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import type { ProtocolCapabilities } from "@/lib/protocol/types";

const DRONE = "drone-chord";

function selectMissionDrone(): void {
  const drone = {
    id: DRONE,
    name: DRONE,
    protocol: {
      isConnected: true,
      getCapabilities: () => ({ supportsMissionUpload: true }) as ProtocolCapabilities,
      getFirmwareHandler: () => null,
    },
  } as unknown as ManagedDrone;
  useDroneManager.setState({ drones: new Map([[DRONE, drone]]), selectedDroneId: DRONE });
}

function applyDefaultLoadout(): void {
  useSettingsStore.setState({
    loadouts: { [DEFAULT_LOADOUT_ID]: cloneDefaultLoadout() },
    activeLoadoutId: DEFAULT_LOADOUT_ID,
  });
}

afterEach(() => {
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
});

describe("useSkillChord", () => {
  it("gives disarm the arm slot's chord", () => {
    applyDefaultLoadout();
    const { result } = renderHook(() => useSkillChord("disarm"));
    expect(result.current).toBe(formatChord("shift+a"));
  });

  it("names a resume chord only while a mission is paused", () => {
    applyDefaultLoadout();
    selectMissionDrone();
    useDroneStore.setState({ armState: "armed", flightMode: "GUIDED", previousMode: "AUTO" });
    const notPaused = renderHook(() => useSkillChord("resume"));
    expect(notPaused.result.current).toBeNull();

    useDroneStore.setState({ flightMode: "LOITER", previousMode: "AUTO" });
    const paused = renderHook(() => useSkillChord("resume"));
    expect(paused.result.current).toBe(formatChord("shift+p"));
  });

  it("follows a rebind", () => {
    const loadout = cloneDefaultLoadout();
    loadout.slots = loadout.slots.map((s) => (s.skillId === "rth" ? { ...s, key: "ctrl+h" } : s));
    useSettingsStore.setState({
      loadouts: { [DEFAULT_LOADOUT_ID]: loadout },
      activeLoadoutId: DEFAULT_LOADOUT_ID,
    });
    const { result } = renderHook(() => useSkillChord("rth"));
    expect(result.current).toBe(formatChord("ctrl+h"));
  });

  it("returns null for an unbound skill", () => {
    applyDefaultLoadout();
    const { result } = renderHook(() => useSkillChord("kill"));
    expect(result.current).toBeNull();
  });
});
