/**
 * Planner inspector: a multi-selection beats a single waypoint, which beats
 * the inspector target; the back arrow returns to the mission view; and the
 * waypoint inspector commits edits through the planner's updateWaypoint.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { Waypoint } from "@/lib/types";
import type * as DroneManagerModule from "@/stores/drone-manager";

vi.mock("@/stores/drone-manager", async (importOriginal) => {
  const actual = await importOriginal<typeof DroneManagerModule>();
  const state = {
    drones: new Map(),
    selectedDroneId: null,
    getSelectedProtocol: () => null,
    getSelectedDrone: () => null,
  };
  const useDroneManager = (sel: (s: typeof state) => unknown) => sel(state);
  useDroneManager.getState = () => state;
  return { ...actual, useDroneManager };
});
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
// The heavy target bodies are covered by their own tests; here they only need
// to say which one rendered.
vi.mock("@/components/planner/inspector/MissionInspector", () => ({ MissionInspector: () => <div>body:mission</div> }));
vi.mock("@/components/planner/inspector/BatchInspector", () => ({ BatchInspector: () => <div>body:batch</div> }));
vi.mock("@/components/planner/inspector/PatternInspector", () => ({ PatternInspector: () => <div>body:pattern</div> }));
vi.mock("@/components/planner/inspector/GeofenceInspector", () => ({ GeofenceInspector: () => <div>body:geofence</div> }));
vi.mock("@/components/planner/inspector/RallyInspector", () => ({ RallyInspector: () => <div>body:rally</div> }));
vi.mock("@/components/planner/inspector/PoiInspector", () => ({ PoiInspector: () => <div>body:poi</div> }));
vi.mock("@/components/planner/inspector/TransformInspector", () => ({ TransformInspector: () => <div>body:transform</div> }));

import { PlannerInspector, resolveInspectorView } from "@/components/planner/inspector/PlannerInspector";
import { WaypointInspector } from "@/components/planner/inspector/WaypointInspector";
import type { Planner } from "@/app/plan/use-planner";
import { usePlannerStore } from "@/stores/planner-store";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const WPS: Waypoint[] = [
  { id: "a", lat: 12.97, lon: 77.59, alt: 30, command: "WAYPOINT" },
  { id: "b", lat: 12.98, lon: 77.6, alt: 40, command: "WAYPOINT" },
  { id: "c", lat: 12.99, lon: 77.61, alt: 50, command: "WAYPOINT" },
];

function makePlanner(overrides: Partial<Planner> = {}): Planner {
  return {
    waypoints: WPS,
    updateWaypoint: vi.fn(),
    removeWaypoint: vi.fn(),
    handleInsertRelative: vi.fn(),
    ...overrides,
  } as unknown as Planner;
}

beforeEach(() => {
  usePlannerStore.setState({
    selectedWaypointId: null,
    selectedWaypointIds: [],
    inspectorTarget: { kind: "pattern" },
    defaultSpeed: 8,
    defaultFrame: "relative",
  });
});
afterEach(cleanup);

describe("resolveInspectorView", () => {
  const ids = WPS.map((w) => w.id);
  const caps = { showGeofence: true, showRally: true };

  it("prefers batch over a single waypoint over the target", () => {
    expect(resolveInspectorView(["a", "b"], "a", ids, { kind: "pattern" }, caps).kind).toBe("batch");
    expect(resolveInspectorView([], "b", ids, { kind: "pattern" }, caps)).toEqual({ kind: "waypoint", id: "b", index: 1 });
    expect(resolveInspectorView([], null, ids, { kind: "pattern" }, caps).kind).toBe("pattern");
  });

  it("ignores a selected id that is not in the mission", () => {
    expect(resolveInspectorView([], "gone", ids, { kind: "transform" }, caps).kind).toBe("transform");
  });

  it("falls back to mission for a target the vehicle cannot use", () => {
    const none = { showGeofence: false, showRally: false };
    expect(resolveInspectorView([], null, ids, { kind: "geofence" }, none).kind).toBe("mission");
    expect(resolveInspectorView([], null, ids, { kind: "rally", id: null }, none).kind).toBe("mission");
  });
});

describe("PlannerInspector", () => {
  const render = () => renderWithIntl(<PlannerInspector p={makePlanner()} showGeofence showRally />);

  it("shows the target when nothing is selected", () => {
    render();
    expect(screen.getByText("body:pattern")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pattern" })).toBeTruthy();
  });

  it("shows the waypoint over the target, and batch over the waypoint", () => {
    usePlannerStore.setState({ selectedWaypointId: "b" });
    const { rerender } = render();
    expect(screen.getByRole("heading", { name: "Waypoint 2" })).toBeTruthy();
    expect(screen.queryByText("body:pattern")).toBeNull();

    usePlannerStore.setState({ selectedWaypointIds: ["a", "c"] });
    rerender(<PlannerInspector p={makePlanner()} showGeofence showRally />);
    expect(screen.getByText("body:batch")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "2 waypoints" })).toBeTruthy();
  });

  it("back arrow clears the selection and returns to the mission view", () => {
    usePlannerStore.setState({ selectedWaypointId: "a" });
    render();
    fireEvent.click(screen.getByRole("button", { name: "Back to mission" }));
    const s = usePlannerStore.getState();
    expect(s.selectedWaypointId).toBeNull();
    expect(s.inspectorTarget).toEqual({ kind: "mission" });
    expect(screen.getByText("body:mission")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to mission" })).toBeNull();
  });
});

describe("WaypointInspector", () => {
  it("commits a typed field through updateWaypoint on blur, not while typing", () => {
    const p = makePlanner();
    renderWithIntl(<WaypointInspector p={p} waypoint={WPS[0]} />);
    const alt = screen.getByRole("spinbutton", { name: "Altitude" });
    fireEvent.change(alt, { target: { value: "" } });
    fireEvent.change(alt, { target: { value: "75" } });
    expect(p.updateWaypoint).not.toHaveBeenCalled();
    fireEvent.blur(alt);
    expect(p.updateWaypoint).toHaveBeenCalledWith("a", { alt: 75 });
  });

  it("shows the mission default as the speed placeholder and resets a set speed", () => {
    const p = makePlanner();
    const { rerender } = renderWithIntl(<WaypointInspector p={p} waypoint={WPS[0]} />);
    expect(screen.getByRole("spinbutton", { name: "Speed" }).getAttribute("placeholder")).toBe("Default (8 m/s)");
    expect(screen.queryByRole("button", { name: "Use the mission default speed" })).toBeNull();

    rerender(<WaypointInspector p={p} waypoint={{ ...WPS[0], speed: 12 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Use the mission default speed" }));
    expect(p.updateWaypoint).toHaveBeenCalledWith("a", { speed: undefined });
  });
});
