/**
 * @license GPL-3.0-only
 *
 * A flying demo drone holds the loop it flies as its onboard mission, reports
 * the item it is flying toward as MISSION_CURRENT, and selecting it loads that
 * mission into the planner through the store's own download — so the WP
 * readout and the Flight map route come off the stores a real link feeds.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useMissionStore } from "@/stores/mission-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { useUploadReceiptsStore } from "@/stores/upload-receipts-store";
import { capturePlanExtras } from "@/lib/plan-workspace";
import { planSnapshotString } from "@/lib/plan-snapshot";
import type { Waypoint } from "@/lib/types";
import { FLIGHT_PATHS } from "../flight-paths";
import { MockProtocol } from "../mock-protocol";
import {
  DemoMissionLoader,
  holdsHomeSlot,
  missionSeqForTarget,
  pathMissionItems,
} from "../engine-mission";

const DRONE = "node:alpha-1";
const OTHER = "node:charlie-3";
const PATROL = FLIGHT_PATHS[0];

function demoDrone(id: string, firmware: "ardupilot-copter" | "px4", path = PATROL): MockProtocol {
  const protocol = new MockProtocol(firmware);
  protocol.loadMission(pathMissionItems(path, holdsHomeSlot(protocol)));
  const drones = new Map(useDroneManager.getState().drones);
  drones.set(id, { id, name: id, protocol } as Partial<ManagedDrone> as ManagedDrone);
  useDroneManager.setState({ drones });
  return protocol;
}

function select(id: string): void {
  useDroneManager.setState({ selectedDroneId: id });
}

/** A clean library plan open in the workspace, as DemoMissionSync leaves it. */
function openSavedPlan(waypoints: Waypoint[]): void {
  useMissionStore.getState().setWaypoints(waypoints);
  const lib = usePlanLibraryStore.getState();
  lib.setActivePlan("plan-open");
  lib.setSavedSnapshot(planSnapshotString(waypoints, capturePlanExtras()));
}

async function settle(pending: Promise<void> | undefined): Promise<void> {
  await vi.advanceTimersByTimeAsync(1_000);
  await pending;
}

const elsewhere = [{ id: "wp-far", lat: 36.1, lon: -112.1, alt: 60 } as Waypoint];

beforeEach(() => {
  vi.useFakeTimers();
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  useMissionStore.setState({ waypoints: [], currentWaypoint: null, downloadState: "idle", downloadWarnings: [] });
  usePlanLibraryStore.setState({ activePlanId: null, isDirty: false, savedSnapshot: "" });
  useUploadReceiptsStore.getState().clearForDrone(DRONE);
  useUploadReceiptsStore.getState().clearForDrone(OTHER);
});

afterEach(() => {
  vi.useRealTimers();
});

const NAV = 16;
const CHANGE_SPEED = 178;

describe("pathMissionItems", () => {
  it("flies the loop as NAV_WAYPOINTs closed back on the start, after ArduPilot's home slot", () => {
    const items = pathMissionItems(PATROL, true);
    expect(items.map((it) => it.seq)).toEqual(items.map((_, i) => i));
    // Home, the loop's one speed, then every point and the return to the start.
    expect(items.map((it) => it.command)).toEqual([NAV, CHANGE_SPEED, ...Array(PATROL.length + 1).fill(NAV)]);
    expect(items[0]).toMatchObject({ frame: 0, x: Math.round(PATROL[0].lat * 1e7) });
    expect(items[1]).toMatchObject({ param1: 1, param2: PATROL[0].speed });
    expect(items[2]).toMatchObject({ x: Math.round(PATROL[0].lat * 1e7), y: Math.round(PATROL[0].lon * 1e7), z: PATROL[0].alt });
    expect(items.at(-1)).toMatchObject({ x: items[2].x, y: items[2].y });
  });

  it("has no home slot for PX4", () => {
    const items = pathMissionItems(PATROL, false);
    expect(items).toHaveLength(PATROL.length + 2);
    expect(items[1]).toMatchObject({ seq: 1, command: NAV, frame: 3, x: Math.round(PATROL[0].lat * 1e7) });
  });

  it("writes a speed change ahead of the leg that flies it", () => {
    const path = [
      { lat: 1, lon: 1, alt: 10, speed: 5 },
      { lat: 1.001, lon: 1, alt: 10, speed: 5 },
      { lat: 1.001, lon: 1.001, alt: 10, speed: 9 },
    ];
    const items = pathMissionItems(path, false);
    // The closing leg leaves the 9 m/s point, so its speed precedes the closing item.
    expect(items.map((it) => it.command)).toEqual([CHANGE_SPEED, NAV, NAV, NAV, CHANGE_SPEED, NAV]);
    expect(items[4].param2).toBe(9);
  });
});

describe("missionSeqForTarget", () => {
  it("names the target's NAV_WAYPOINT and wraps through the closing item", () => {
    for (const homeSlot of [false, true]) {
      const items = pathMissionItems(PATROL, homeSlot);
      for (const target of [1, 3, PATROL.length - 1]) {
        const item = items[missionSeqForTarget(PATROL, target, homeSlot)];
        expect(item).toMatchObject({ command: NAV, x: Math.round(PATROL[target].lat * 1e7) });
      }
      expect(missionSeqForTarget(PATROL, 0, homeSlot)).toBe(items.length - 1);
    }
  });
});

describe("DemoMissionLoader", () => {
  it("loads the selected drone's route so MISSION_CURRENT names the waypoint it flies toward", async () => {
    openSavedPlan(elsewhere);
    const protocol = demoDrone(DRONE, "ardupilot-copter");
    select(DRONE);

    await settle(new DemoMissionLoader().onSelection(DRONE, protocol));

    const { waypoints } = useMissionStore.getState();
    expect(waypoints).toHaveLength(PATROL.length + 1);
    // Detached from the library plan it replaced, so nothing saves over it.
    expect(usePlanLibraryStore.getState().activePlanId).toBeNull();

    // The bridge's MISSION_CURRENT handling, for the drone heading to point 3.
    const seq = missionSeqForTarget(PATROL, 3, holdsHomeSlot(protocol));
    useMissionStore.getState().applyMissionCurrent(DRONE, seq);
    const current = useMissionStore.getState().currentWaypoint;
    expect(current).toBe(3);
    expect(waypoints[current!].lat).toBeCloseTo(PATROL[3].lat, 6);
    expect(waypoints[current!].lon).toBeCloseTo(PATROL[3].lon, 6);

    // Heading home to point 0 is the closing waypoint, the last of the route.
    useMissionStore.getState().applyMissionCurrent(DRONE, missionSeqForTarget(PATROL, 0, true));
    expect(useMissionStore.getState().currentWaypoint).toBe(PATROL.length);
  });

  it("acts once per selection", async () => {
    const protocol = demoDrone(DRONE, "ardupilot-copter");
    select(DRONE);
    const loader = new DemoMissionLoader();
    await settle(loader.onSelection(DRONE, protocol));
    expect(loader.onSelection(DRONE, protocol)).toBeUndefined();
  });

  it("never replaces a plan with unsaved edits", async () => {
    useMissionStore.getState().setWaypoints(elsewhere);
    const protocol = demoDrone(DRONE, "ardupilot-copter");
    const download = vi.spyOn(protocol, "downloadMission");
    select(DRONE);

    await settle(new DemoMissionLoader().onSelection(DRONE, protocol));

    expect(download).not.toHaveBeenCalled();
    expect(useMissionStore.getState().waypoints).toEqual(elsewhere);
  });

  it("replaces its own earlier download when another drone is selected", async () => {
    openSavedPlan(elsewhere);
    const alpha = demoDrone(DRONE, "ardupilot-copter");
    const charlie = demoDrone(OTHER, "px4", FLIGHT_PATHS[2]);
    const loader = new DemoMissionLoader();
    select(DRONE);
    await settle(loader.onSelection(DRONE, alpha));

    select(OTHER);
    await settle(loader.onSelection(OTHER, charlie));

    const { waypoints } = useMissionStore.getState();
    expect(waypoints).toHaveLength(FLIGHT_PATHS[2].length + 1);
    expect(waypoints[0].lat).toBeCloseTo(FLIGHT_PATHS[2][0].lat, 6);
    expect(waypoints[0].lon).toBeCloseTo(FLIGHT_PATHS[2][0].lon, 6);
    useMissionStore.getState().applyMissionCurrent(OTHER, missionSeqForTarget(FLIGHT_PATHS[2], 1, false));
    expect(useMissionStore.getState().currentWaypoint).toBe(1);
  });
});

describe("MockProtocol mission", () => {
  it("returns what was uploaded and holds nothing after a clear", async () => {
    const protocol = new MockProtocol("px4");
    const items = pathMissionItems(PATROL.slice(0, 3), false);
    await protocol.uploadMission(items);
    const download = protocol.downloadMission();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await download).toEqual(items);

    await protocol.clearMission();
    const empty = protocol.downloadMission();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await empty).toEqual([]);
  });

  it("reports MISSION_CURRENT to its mission-progress subscribers", () => {
    const protocol = new MockProtocol();
    const seen: number[] = [];
    protocol.onMissionProgress((d) => seen.push(d.currentSeq));
    protocol.emitMissionCurrent(4);
    expect(seen).toEqual([4]);
  });
});
