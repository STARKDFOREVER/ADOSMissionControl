/**
 * Share links: the shared plan always lands in the library, opens only when no
 * unsaved work would be lost, a damaged link says so, and the fragment is
 * always cleared.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
const toasts = vi.hoisted(() => ({ calls: [] as Array<{ message: string; status?: string; action?: { label: string; onClick: () => void } }> }));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({
    toast: (message: string, status?: string, options?: { action?: { label: string; onClick: () => void } }) =>
      toasts.calls.push({ message, status, action: options?.action }),
  }),
}));

import { openSharedPlan, useSharedPlanLink } from "@/app/plan/use-shared-plan-link";
import { buildMissionFile, encodePlan } from "@/lib/plan-share";
import { useMissionStore } from "@/stores/mission-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { IntlWrapper } from "../helpers/intl-wrapper";
import type { Waypoint } from "@/lib/types";

const SHARED: Waypoint[] = [
  { id: "s1", lat: 36.1, lon: -112.1, alt: 30, command: "TAKEOFF" },
  { id: "s2", lat: 36.11, lon: -112.1, alt: 60, command: "WAYPOINT" },
];
const FILE = buildMissionFile(SHARED, { name: "Canyon run", createdAt: 0, updatedAt: 0 }, {
  settings: { plannedHome: { lat: 36.09, lon: -112.1 }, vehicle: { autopilot: "px4", vehicleClass: "copter" } },
});
const LOCAL: Waypoint[] = [{ id: "l1", lat: 12.9, lon: 77.5, alt: 40, command: "WAYPOINT" }];

function resetWorkspace() {
  useMissionStore.setState({ waypoints: [], plannedHome: null, vehicleProfile: null, transitAltM: null });
  usePlanLibraryStore.setState({ plans: [], activePlanId: null, isDirty: false, savedSnapshot: "" });
}

describe("openSharedPlan", () => {
  beforeEach(resetWorkspace);

  it("opens the shared plan with its settings when nothing is unsaved", () => {
    const result = openSharedPlan(FILE, "Untitled");
    expect(result.opened).toBe(true);
    const lib = usePlanLibraryStore.getState();
    expect(lib.activePlanId).toBe(result.planId);
    expect(lib.plans[0]).toMatchObject({ name: "Canyon run", metadata: {} });
    expect(useMissionStore.getState().waypoints.map((w) => w.id)).toEqual(["s1", "s2"]);
    expect(useMissionStore.getState().vehicleProfile).toEqual({ autopilot: "px4", vehicleClass: "copter" });
    expect(useMissionStore.getState().plannedHome).toEqual({ lat: 36.09, lon: -112.1 });
  });

  it("saves to the library without switching when the workspace has unsaved work", () => {
    usePlanLibraryStore.getState().createPlan("Mine", LOCAL, {}, {});
    const mineId = usePlanLibraryStore.getState().activePlanId;
    useMissionStore.setState({ waypoints: [...LOCAL, { id: "l2", lat: 12.91, lon: 77.5, alt: 40 }] });
    const snapshot = usePlanLibraryStore.getState().savedSnapshot;

    const result = openSharedPlan(FILE, "Untitled");
    expect(result.opened).toBe(false);
    const lib = usePlanLibraryStore.getState();
    expect(lib.plans.map((p) => p.name).sort()).toEqual(["Canyon run", "Mine"]);
    expect(lib.activePlanId).toBe(mineId);
    expect(lib.savedSnapshot).toBe(snapshot);
    expect(useMissionStore.getState().waypoints.map((w) => w.id)).toEqual(["l1", "l2"]);
  });
});

describe("useSharedPlanLink", () => {
  beforeEach(() => {
    resetWorkspace();
    toasts.calls.length = 0;
  });

  it("opens a link, toasts it and clears the fragment", async () => {
    window.history.replaceState(null, "", `/plan#plan=${encodePlan(FILE)}`);
    const onLoaded = vi.fn();
    renderHook(() => useSharedPlanLink(onLoaded), { wrapper: IntlWrapper });
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith({ name: "Canyon run" }));
    expect(toasts.calls).toEqual([expect.objectContaining({ message: "Opened shared plan", status: "success" })]);
    expect(window.location.hash).toBe("");
  });

  it("with unsaved work offers to open the saved copy", async () => {
    useMissionStore.setState({ waypoints: LOCAL });
    window.history.replaceState(null, "", `/plan#plan=${encodePlan(FILE)}`);
    const onLoaded = vi.fn();
    renderHook(() => useSharedPlanLink(onLoaded), { wrapper: IntlWrapper });
    await waitFor(() => expect(toasts.calls).toHaveLength(1));
    const [saved] = toasts.calls;
    expect(saved.message).toBe("Shared plan saved to your library as “Canyon run”");
    expect(onLoaded).not.toHaveBeenCalled();
    expect(useMissionStore.getState().waypoints.map((w) => w.id)).toEqual(["l1"]);
    expect(window.location.hash).toBe("");

    // "Open" keeps the unsaved work in a plan of its own, then opens the shared one.
    saved.action?.onClick();
    expect(onLoaded).toHaveBeenCalledWith({ name: "Canyon run", droneId: undefined });
    expect(useMissionStore.getState().waypoints.map((w) => w.id)).toEqual(["s1", "s2"]);
    expect(usePlanLibraryStore.getState().plans).toHaveLength(2);
  });

  it("names a damaged link and clears it", () => {
    window.history.replaceState(null, "", "/plan#plan=not-a-plan");
    renderHook(() => useSharedPlanLink(vi.fn()), { wrapper: IntlWrapper });
    expect(toasts.calls).toEqual([
      expect.objectContaining({ message: "This share link is damaged or from a newer version", status: "error" }),
    ]);
    expect(window.location.hash).toBe("");
    expect(usePlanLibraryStore.getState().plans).toHaveLength(0);
  });
});

describe("useSharedPlanLink when browser storage misbehaves", () => {
  const NOT_KEPT = "Opened the shared plan, but browser storage is unavailable, so it won't be kept after a reload";
  const WAITING = "Your saved plans are still loading. The shared plan opens when they're ready";

  /** Fresh stores and hook over a storage whose reads follow `getItem`. */
  async function load(getItem: () => Promise<string | null>) {
    vi.resetModules();
    vi.doMock("@/lib/storage", () => ({
      indexedDBStorage: {
        storage: () => ({ getItem, setItem: vi.fn().mockResolvedValue(undefined), removeItem: vi.fn().mockResolvedValue(undefined) }),
      },
    }));
    const hook = await import("@/app/plan/use-shared-plan-link");
    const { IntlWrapper: Wrapper } = await import("../helpers/intl-wrapper");
    return { useLink: hook.useSharedPlanLink, Wrapper };
  }

  beforeEach(() => {
    toasts.calls.length = 0;
    window.history.replaceState(null, "", `/plan#plan=${encodePlan(FILE)}`);
  });
  afterEach(() => {
    vi.doUnmock("@/lib/storage");
    vi.useRealTimers();
  });

  it("opens the plan for this session and warns it will not be kept when the read fails", async () => {
    const { useLink, Wrapper } = await load(() => Promise.reject(new Error("read failed")));
    const onLoaded = vi.fn();
    renderHook(() => useLink(onLoaded), { wrapper: Wrapper });
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith({ name: "Canyon run" }));
    expect(toasts.calls).toEqual([expect.objectContaining({ message: NOT_KEPT, status: "warning" })]);
    expect(window.location.hash).toBe("");
  });

  it("says the link waits on slow storage, then opens once the stored plans arrive", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let release: (value: string | null) => void = () => {};
    const pending = new Promise<string | null>((resolve) => { release = resolve; });
    const { useLink, Wrapper } = await load(() => pending);
    const onLoaded = vi.fn();
    renderHook(() => useLink(onLoaded), { wrapper: Wrapper });

    await act(() => vi.advanceTimersByTimeAsync(4_999));
    expect(toasts.calls).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(toasts.calls).toEqual([expect.objectContaining({ message: WAITING, status: "info" })]);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(toasts.calls).toHaveLength(1);
    expect(onLoaded).not.toHaveBeenCalled();
    expect(window.location.hash).not.toBe("");

    await act(async () => {
      release(null);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith({ name: "Canyon run" });
    expect(window.location.hash).toBe("");
  });
});
