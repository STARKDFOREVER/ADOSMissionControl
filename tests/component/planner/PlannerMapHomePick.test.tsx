/**
 * The planner map's one-shot "pick the planned home" mode, and when it shows
 * the leg insert handles.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import type { Waypoint } from "@/lib/types";

const map = vi.hoisted(() => {
  const handlers: Record<string, (e?: unknown) => void> = {};
  const state = { zoom: 16 };
  const self: Record<string, unknown> = {};
  const chain = () => self;
  Object.assign(self, {
    on: (ev: string, fn: (e?: unknown) => void) => { handlers[ev] = fn; return self; },
    off: chain, fire: chain, setView: chain, invalidateSize: chain, fitBounds: chain, panTo: chain,
    getContainer: () => document.body,
    getCenter: () => ({ lat: 12.97, lng: 77.59 }),
    getZoom: () => state.zoom,
    getBounds: () => ({ getNorth: () => 13, getSouth: () => 12, getEast: () => 78, getWest: () => 77 }),
    latLngToContainerPoint: () => ({ x: 0, y: 0 }),
  });
  return { handlers, state, self };
});

// Every lazily loaded map piece renders its children; the map container hands
// its ref the fake map, as react-leaflet does once Leaflet is up.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Lazy({ ref, children }: { ref?: unknown; children?: ReactNode }) {
      useEffect(() => {
        if (typeof ref === "function") ref(map.self);
      }, [ref]);
      return <>{children}</>;
    },
}));
vi.mock("react-leaflet", () => ({
  Marker: (props: { position: [number, number] }) => <div data-testid="handle" data-pos={props.position.join(",")} />,
  Polyline: () => null,
  Tooltip: () => null,
  useMapEvents: () => null,
}));
vi.mock("@/lib/drawing/drawing-manager", () => ({
  DrawingManager: class {
    getMode() { return null; }
    getVertexCount() { return 0; }
    setCallbacks() {}
    setUnitSystem() {}
    setSnapTargets() {}
    cancelDraw() {}
    destroy() {}
  },
}));
vi.mock("@/hooks/use-initial-planner-view", () => ({
  useInitialPlannerView: () => ({ center: [12.97, 77.59], zoom: 16, source: "default", hydrated: false }),
}));
vi.mock("@/components/planner/PlannerLiveVehicle", () => ({
  PlannerGpsBadge: () => null,
  PlannerGuidanceVectors: () => null,
}));
vi.mock("@/components/plugins/FleetPluginSlot", () => ({ FleetPluginSlot: () => null }));
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import { PlannerMap } from "@/components/planner/PlannerMap";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const WPS: Waypoint[] = [
  { id: "a", lat: 12.97, lon: 77.59, alt: 0, command: "TAKEOFF" },
  { id: "b", lat: 12.972, lon: 77.592, alt: 50, command: "WAYPOINT" },
];

async function renderMap() {
  const onMapClick = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  await act(async () => {
    renderWithIntl(
      <PlannerMap waypoints={WPS} activeTool="select" selectedWaypointId={null} hasActivePlan
        onMapClick={onMapClick} onMapRightClick={vi.fn()} onWaypointClick={vi.fn()}
        onWaypointDragEnd={vi.fn()} onWaypointRightClick={vi.fn()} />,
    );
  });
  return onMapClick;
}

const click = (lat: number, lng: number) => act(() => map.handlers.click?.({ latlng: { lat, lng } }));

beforeEach(() => {
  map.state.zoom = 16;
  useMissionStore.setState({ waypoints: WPS, plannedHome: null });
  usePlannerStore.setState({ activeTool: "select", homePickArmed: false });
  useDrawingStore.setState({ drawingMode: null });
});

describe("PlannerMap pick home", () => {
  it("a click while armed sets the planned home, disarms, and adds no waypoint", async () => {
    usePlannerStore.setState({ homePickArmed: true });
    const onMapClick = await renderMap();
    expect(screen.getByText("Click the map to set the planned home")).toBeInTheDocument();
    click(12.9705, 77.5905);
    expect(useMissionStore.getState().plannedHome).toEqual({ lat: 12.9705, lon: 77.5905 });
    expect(usePlannerStore.getState().homePickArmed).toBe(false);
    expect(onMapClick).not.toHaveBeenCalled();
    expect(screen.queryByText("Click the map to set the planned home")).toBeNull();
  });

  it("a click while not armed goes to the active tool", async () => {
    const onMapClick = await renderMap();
    click(12.9705, 77.5905);
    expect(onMapClick).toHaveBeenCalledWith(12.9705, 77.5905);
    expect(useMissionStore.getState().plannedHome).toBeNull();
  });

  it("Escape disarms", async () => {
    usePlannerStore.setState({ homePickArmed: true });
    await renderMap();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(usePlannerStore.getState().homePickArmed).toBe(false);
  });
});

describe("PlannerMap leg insert handles", () => {
  it("shows a handle per leg in select mode at zoom 15+", async () => {
    await renderMap();
    expect(screen.getAllByTestId("handle")).toHaveLength(1);
  });

  it("hides the handles while drawing", async () => {
    useDrawingStore.setState({ drawingMode: "polygon" });
    await renderMap();
    expect(screen.queryAllByTestId("handle")).toHaveLength(0);
  });

  it("hides the handles after zooming out below 15", async () => {
    await renderMap();
    map.state.zoom = 14;
    act(() => map.handlers.zoomend?.());
    expect(screen.queryAllByTestId("handle")).toHaveLength(0);
  });
});
