/**
 * @license GPL-3.0-only
 * MissionAdvisories RTL rows: the return-leg terrain advisory only surfaces when
 * home coordinates, terrain elevation and the vehicle's configured return
 * altitude are genuinely available, renders the pure module's own messages
 * (naming the return point), and says the check did not run when the return
 * altitude is unknown. Home is the plan's planned home, never a telemetry home.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
const getElevations = vi.fn<(points: Array<{ lat: number; lon: number }>) => Promise<Array<number | null>>>(
  async (points) => points.map(() => null),
);
vi.mock("@/lib/terrain/terrain-provider", () => ({
  getElevation: async () => null,
  getElevations: (points: Array<{ lat: number; lon: number }>) => getElevations(points),
}));
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => {}),
      removeItem: vi.fn(async () => {}),
    }),
  },
}));

import { MissionAdvisories } from "@/components/planner/MissionAdvisories";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useMissionStore } from "@/stores/mission-store";
import { useRallyStore } from "@/stores/rally-store";
import { selectTestProtocol } from "../../../../tests/helpers/selected-drone";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { RingBuffer } from "@/lib/ring-buffer";
import type { Waypoint, HomePositionData } from "@/lib/types";

function wp(
  id: string,
  lat: number,
  lon: number,
  groundElevation?: number,
): Waypoint {
  return { id, lat, lon, alt: 50, command: "WAYPOINT", groundElevation };
}

const noop = () => {};

/** A copter whose RTL_ALT is `cm` centimetres; it predates RTL_ALT_M and reports nothing else. */
function copterWithRtlAlt(cm = 3000) {
  const protocol = {
    getVehicleInfo: () => ({ firmwareType: "ardupilot-copter" }),
    getParameter: vi.fn(async (name: string) => {
      if (name !== "RTL_ALT") throw new Error(`no parameter ${name}`);
      return { name, value: cm, type: 9, index: 0, count: 1 };
    }),
  };
  selectTestProtocol(protocol);
  return protocol;
}

beforeEach(() => {
  getElevations.mockReset();
  getElevations.mockImplementation(async (points) => points.map(() => null));
  useGeofenceStore.setState({ enabled: false, maxAltitude: 0 });
  useMissionStore.setState({ plannedHome: null, vehicleProfile: null });
  useRallyStore.setState({ points: [] });
  selectTestProtocol(null);
  useTelemetryStore.setState({
    homePosition: new RingBuffer<HomePositionData>(12),
  });
});

describe("MissionAdvisories — RTL return terrain", () => {
  it("flags a return leg that clips terrain at the vehicle's RTL altitude", async () => {
    // No planned home: home falls back to WP1 (900 m MSL terrain); WP2 sits
    // over 1000 m terrain. The vehicle's 30 m return altitude (cruise 930 m
    // MSL) is below the 1000 m ridge on the direct leg home.
    const protocol = copterWithRtlAlt();
    const waypoints = [
      wp("a", 12.9716, 77.5946, 900),
      wp("b", 13.0716, 77.5946, 1000),
    ];
    render(<MissionAdvisories waypoints={waypoints} onSelectWaypoint={noop} />);

    expect(
      await screen.findByText(/RTL from WP2 \(return to home\) would clip terrain/i),
    ).toBeInTheDocument();
    expect(protocol.getParameter).toHaveBeenCalledWith("RTL_ALT");
    expect(screen.getByText("rtl.returnAltitudeFromVehicle")).toBeInTheDocument();
  });

  it("reports the return-leg check as not run when no RTL altitude was read", () => {
    const waypoints = [
      wp("a", 12.9716, 77.5946, 900),
      wp("b", 13.0716, 77.5946, 1000),
    ];
    render(<MissionAdvisories waypoints={waypoints} onSelectWaypoint={noop} />);

    expect(screen.queryByText(/RTL from/i)).toBeNull();
    expect(screen.getByText("rtl.returnAltitudeUnknown")).toBeInTheDocument();
  });

  it("renders no RTL rows when terrain elevation is unknown", () => {
    const waypoints = [wp("a", 12.9716, 77.5946), wp("b", 13.0716, 77.5946)];
    render(<MissionAdvisories waypoints={waypoints} onSelectWaypoint={noop} />);

    expect(screen.queryByText(/RTL from/i)).toBeNull();
    expect(screen.queryByText("rtl.returnAltitudeUnknown")).toBeNull();
  });

  it("takes the RTL datum from the planned home and its ground, not WP1", async () => {
    // Launch from a 100 m valley; the mission flies a 300 m plateau 8 km north.
    // The return cruise is 30 m above home's ground (130 m MSL), straight into
    // the plateau. Pairing home with WP1's 300 m ground would hide it.
    useMissionStore.setState({ plannedHome: { lat: 12.9, lon: 77.5946, groundAmsl: 100 } });
    copterWithRtlAlt();

    const waypoints = [
      wp("a", 12.9716, 77.5946, 300),
      wp("b", 12.9816, 77.5946, 300),
    ];
    render(<MissionAdvisories waypoints={waypoints} onSelectWaypoint={noop} />);

    expect(
      await screen.findByText(/RTL from WP1 \(return to home\) would clip terrain: the 130 m MSL/i),
    ).toBeInTheDocument();
  });

  it("never pairs a planned home of unknown ground with WP1's terrain, and ignores a telemetry home", async () => {
    // The vehicle reports a home 8 km south; the plan's own home has no ground
    // sample yet. Neither the telemetry home nor WP1's ground is used.
    const home = new RingBuffer<HomePositionData>(12);
    home.push({ timestamp: Date.now(), lat: 12.9, lon: 77.5946, alt: 100 });
    useTelemetryStore.setState({ homePosition: home });
    useMissionStore.setState({ plannedHome: { lat: 12.9716, lon: 77.5946 } });
    const protocol = copterWithRtlAlt();

    const waypoints = [
      wp("a", 12.9716, 77.5946, 300),
      wp("b", 12.9816, 77.5946, 400),
    ];
    render(<MissionAdvisories waypoints={waypoints} onSelectWaypoint={noop} />);

    await vi.waitFor(() => expect(protocol.getParameter).toHaveBeenCalledWith("RTL_ALT"));
    expect(screen.queryByText(/RTL from/i)).toBeNull();
  });

  it("checks the leg to the rally point ArduCopter returns to, and names it", async () => {
    // Home on 900 m ground, WP2 10 km north on 1000 m ground; a rally point
    // 200 m from WP2 (inside Copter's 0.3 km RALLY_LIMIT_KM, closer than home)
    // sits on 1000 m ground, so the 930 m MSL cruise to it clips terrain.
    useMissionStore.setState({ plannedHome: { lat: 12.9716, lon: 77.5946, groundAmsl: 900 } });
    useRallyStore.setState({ points: [{ id: "r1", lat: 13.0734, lon: 77.5946, alt: 30 }] });
    getElevations.mockImplementation(async (points) => points.map(() => 1000));
    copterWithRtlAlt();

    const waypoints = [
      wp("a", 12.9716, 77.5946, 900),
      wp("b", 13.0716, 77.5946, 1000),
    ];
    render(<MissionAdvisories waypoints={waypoints} onSelectWaypoint={noop} />);

    expect(
      await screen.findByText(/RTL from WP2 \(return to rally point 1\) would clip terrain.*direct leg to rally point 1/i),
    ).toBeInTheDocument();
  });

  it("caps the return altitude at the altitude fence's safe ceiling", async () => {
    // RTL_ALT 120 m, FENCE_ALT_MAX 100 m and the default 2 m margin: ArduPilot
    // returns at 98 m, which clips a 100 m ridge that 120 m would clear.
    useMissionStore.setState({ plannedHome: { lat: 12.9716, lon: 77.5946, groundAmsl: 0 } });
    useGeofenceStore.setState({ enabled: true, maxAltitude: 100 });
    copterWithRtlAlt(12000);

    const waypoints = [
      wp("a", 12.9716, 77.5946, 0),
      wp("b", 13.0716, 77.5946, 100),
    ];
    render(<MissionAdvisories waypoints={waypoints} onSelectWaypoint={noop} />);

    expect(await screen.findByText(/RTL from WP2 \(return to home\) would clip terrain: the 98 m MSL/i)).toBeInTheDocument();
    expect(screen.getByText("rtl.returnAltitudeCappedByFence")).toBeInTheDocument();
  });
});
