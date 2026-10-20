/**
 * Planned-home seed: a plan without a planned home takes the vehicle's home
 * when it is at the plan's site, else the plan's launch point; the ground
 * under the home is filled from the elevation cache; neither write is an undo
 * step or an unsaved change.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const terrain = vi.hoisted(() => ({ getElevation: vi.fn(async () => 412 as number | null) }));
vi.mock("@/lib/terrain/terrain-provider", () => ({ getElevation: terrain.getElevation }));
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import { usePlannedHomeSeed, plannedHomeSeed } from "@/app/plan/use-planned-home-seed";
import { useMissionStore } from "@/stores/mission-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { canUndo, clearHistory } from "@/lib/planner-history";
import { workspaceHasUnsavedChanges } from "@/lib/plan-workspace";
import type { Waypoint } from "@/lib/types";

const PLAN: Waypoint[] = [
  { id: "t", lat: 36.1, lon: -112.1, alt: 30, command: "TAKEOFF" },
  { id: "a", lat: 36.11, lon: -112.1, alt: 60, command: "WAYPOINT" },
];

function pushVehicleHome(lat: number, lon: number) {
  useTelemetryStore.getState().pushHomePosition({ timestamp: 1, lat, lon, alt: 900 });
}

describe("plannedHomeSeed", () => {
  it("takes the vehicle's home within 50 km of the launch point", () => {
    expect(plannedHomeSeed(PLAN, { lat: 36.2, lon: -112.1 })).toEqual({ lat: 36.2, lon: -112.1 });
  });

  it("takes the launch point when the vehicle is at another site", () => {
    expect(plannedHomeSeed(PLAN, { lat: 12.97, lon: 77.59 })).toEqual({ lat: 36.1, lon: -112.1 });
    expect(plannedHomeSeed(PLAN, undefined)).toEqual({ lat: 36.1, lon: -112.1 });
  });

  it("gives nothing for a plan with no launch point", () => {
    expect(plannedHomeSeed([], { lat: 1, lon: 2 })).toBeNull();
  });
});

describe("usePlannedHomeSeed", () => {
  beforeEach(() => {
    terrain.getElevation.mockClear();
    terrain.getElevation.mockResolvedValue(412);
    useTelemetryStore.getState().clear();
    useMissionStore.setState({ waypoints: PLAN, plannedHome: null, vehicleProfile: null, transitAltM: null });
    usePlanLibraryStore.setState({ plans: [], activePlanId: null, isDirty: false, savedSnapshot: "" });
    clearHistory();
  });

  it("seeds from a far vehicle's home only by launch point, then fills the ground", async () => {
    pushVehicleHome(12.97, 77.59);
    renderHook(() => usePlannedHomeSeed());
    await waitFor(() => expect(useMissionStore.getState().plannedHome).toEqual({ lat: 36.1, lon: -112.1, groundAmsl: 412 }));
    expect(terrain.getElevation).toHaveBeenCalledWith(36.1, -112.1, expect.any(AbortSignal));
    expect(canUndo()).toBe(false);
  });

  it("keeps a saved plan clean while seeding it", async () => {
    usePlanLibraryStore.getState().createPlan("Canyon", PLAN, {}, {});
    expect(workspaceHasUnsavedChanges()).toBe(false);
    renderHook(() => usePlannedHomeSeed());
    await waitFor(() => expect(useMissionStore.getState().plannedHome?.groundAmsl).toBe(412));
    expect(workspaceHasUnsavedChanges()).toBe(false);
  });

  it("leaves an existing planned home in place and only fills its ground", async () => {
    useMissionStore.setState({ plannedHome: { lat: 36.05, lon: -112.05 } });
    renderHook(() => usePlannedHomeSeed());
    await waitFor(() => expect(useMissionStore.getState().plannedHome).toEqual({ lat: 36.05, lon: -112.05, groundAmsl: 412 }));
  });

  it("an unknown ground stays unknown", async () => {
    terrain.getElevation.mockResolvedValue(null);
    renderHook(() => usePlannedHomeSeed());
    await waitFor(() => expect(terrain.getElevation).toHaveBeenCalled());
    expect(useMissionStore.getState().plannedHome).toEqual({ lat: 36.1, lon: -112.1 });
  });
});
