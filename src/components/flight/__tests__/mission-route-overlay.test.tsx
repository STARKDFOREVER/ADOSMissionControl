/**
 * @license GPL-3.0-only
 *
 * The Flight map draws the mission route and the waypoint the aircraft is
 * heading to only while MISSION_CURRENT maps onto the open plan; a plan the
 * aircraft does not hold (no current waypoint) is never drawn as its route.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("react-leaflet", () => ({
  Polyline: ({ positions }: { positions: [number, number][] }) => (
    <div data-testid="route" data-points={positions.length} />
  ),
  CircleMarker: ({ center, radius, children }: { center: [number, number]; radius: number; children?: ReactNode }) => (
    <div data-testid="wp" data-pos={center.join(",")} data-radius={radius}>
      {children}
    </div>
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

import { MissionRouteOverlay } from "../MissionRouteOverlay";
import { useMissionStore } from "@/stores/mission-store";
import type { Waypoint } from "@/lib/types";

const route = [
  { id: "a", lat: 47.0, lon: 8.0, alt: 40 },
  { id: "b", lat: 47.001, lon: 8.0, alt: 40 },
  { id: "c", lat: 47.001, lon: 8.001, alt: 40 },
  { id: "d", lat: 47.0, lon: 8.001, alt: 40 },
] as Waypoint[];

beforeEach(() => {
  useMissionStore.setState({ waypoints: route, currentWaypoint: null });
});
afterEach(cleanup);

describe("MissionRouteOverlay", () => {
  it("draws nothing while no current waypoint maps onto the plan", () => {
    const { container } = render(<MissionRouteOverlay />);
    expect(container.innerHTML).toBe("");
  });

  it("draws the route and marks the waypoint being flown to", () => {
    useMissionStore.setState({ currentWaypoint: 2 });
    const { container, getByText } = render(<MissionRouteOverlay />);

    expect(container.querySelector('[data-testid="route"]')?.getAttribute("data-points")).toBe("4");
    const markers = Array.from(container.querySelectorAll('[data-testid="wp"]'));
    expect(markers).toHaveLength(4);
    const active = markers.filter((m) => m.getAttribute("data-radius") === "8");
    expect(active.map((m) => m.getAttribute("data-pos"))).toEqual(["47.001,8.001"]);
    expect(getByText("WP 3")).toBeTruthy();
  });
});
