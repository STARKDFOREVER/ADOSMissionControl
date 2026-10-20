/**
 * Wire encoding per autopilot: frames, heading, autocontinue, current flag,
 * ROI, speed type, PX4 delay and terrain frame, and the PX4 command lists.
 * @license GPL-3.0-only
 */
import { describe, it, expect, beforeEach } from "vitest";
import { expandToItems, collapseFromItems } from "@/lib/mission/mission-expand";
import { missionUploadItems } from "@/lib/mission-upload";
import { usePlannerStore } from "@/stores/planner-store";
import { MockProtocol } from "@/mock/mock-protocol";
import { PX4Handler, px4AcceptedActions } from "@/lib/protocol/firmware/px4";
import { commandChangeUpdate, defaultActionParams } from "@/components/planner/waypoint-constants";
import type { MissionItem } from "@/lib/protocol/types";
import type { AltitudeFrame, PlanVehicleProfile, Waypoint } from "@/lib/types/mission";

const PX4_COPTER: PlanVehicleProfile = { autopilot: "px4", vehicleClass: "copter" };
const AP_COPTER = { autopilot: "ardupilot", vehicleClass: "copter", defaultFrame: "relative" as AltitudeFrame } as const;

function tkWpRtl(): Waypoint[] {
  return [
    { id: "t", lat: 47.39, lon: 8.54, alt: 20, command: "TAKEOFF" },
    { id: "w", lat: 47.391, lon: 8.541, alt: 30, command: "WAYPOINT" },
    { id: "r", lat: 47.391, lon: 8.541, alt: 0, command: "RTL" },
  ];
}

beforeEach(() => {
  usePlannerStore.setState({ defaultFrame: "relative", defaultSpeed: 5 });
});

describe("PX4 upload of TAKEOFF, WP, RTL with default speed 5", () => {
  it("writes the speed item first in frame 2 as the current item, RTL in frame 2, and a NaN heading", () => {
    const items = missionUploadItems(tkWpRtl(), PX4_COPTER);
    expect(items[0]).toMatchObject({ seq: 0, command: 178, frame: 2, current: 1, param2: 5 });
    expect(items.filter((it) => it.current === 1)).toHaveLength(1);
    const rtl = items.find((it) => it.command === 20)!;
    expect(rtl.frame).toBe(2);
    const wp = items.find((it) => it.command === 16)!;
    expect(wp.frame).toBe(3);
    expect(Number.isNaN(wp.param4)).toBe(true);
    expect(Number.isNaN(items.find((it) => it.command === 22)!.param4)).toBe(true);
  });

  it("is accepted by the PX4 demo vehicle, which refuses the same items in the old frame layout", async () => {
    const items = missionUploadItems(tkWpRtl(), PX4_COPTER);
    const px4 = new MockProtocol("px4");
    expect((await px4.uploadMission(items)).success).toBe(true);
    // The previous encoding: every item in the parent waypoint's frame (3).
    const old: MissionItem[] = items.map((it) => ({ ...it, frame: 3 }));
    const refused = await new MockProtocol("px4").uploadMission(old);
    expect(refused.success).toBe(false);
    expect(refused.resultCode).toBe(3);
  });

  it("keeps the speed item at seq 1 current-free after an ArduPilot home slot", () => {
    const items = missionUploadItems(tkWpRtl(), { autopilot: "ardupilot", vehicleClass: "copter" }, { lat: 47.39, lon: 8.54, alt: 400 });
    expect(items[0].current).toBe(0);
    expect(items[1]).toMatchObject({ command: 178, current: 1 });
  });
});

describe("non-positional actions", () => {
  it("go out in MAV_FRAME_MISSION; ROI keeps the waypoint frame as DO_SET_ROI_LOCATION", () => {
    const wps: Waypoint[] = [{
      id: "a", lat: 1, lon: 2, alt: 30, frame: "absolute",
      actions: [
        { id: "x", command: "DO_DIGICAM", param5: 1 },
        { id: "y", command: "ROI", lat: 1.1, lon: 2.1, alt: 0 },
      ],
    }];
    const items = expandToItems(wps, AP_COPTER);
    expect(items[1]).toMatchObject({ command: 203, frame: 2 });
    expect(items[2]).toMatchObject({ command: 195, frame: 0, param1: 0, x: 11000000 });
  });

  it("DO_LAND_START goes out in frame 2 and keeps its position", () => {
    const wps: Waypoint[] = [
      { id: "a", lat: 1, lon: 2, alt: 30 },
      { id: "b", lat: 1.5, lon: 2.5, alt: 0, command: "DO_LAND_START" },
      { id: "c", lat: 1.6, lon: 2.6, alt: 0, command: "LAND" },
    ];
    const land = expandToItems(wps, AP_COPTER).find((it) => it.command === 189)!;
    expect(land).toMatchObject({ frame: 2, x: 15000000, y: 25000000 });
  });
});

describe("collapse of the new encoding", () => {
  it("restores an RTL in frame 2 to the previous waypoint's frame and keeps NaN headings unset", () => {
    const wps: Waypoint[] = [
      { id: "a", lat: 1, lon: 2, alt: 30, frame: "absolute" },
      { id: "r", lat: 0, lon: 0, alt: 0, command: "RTL", inheritsPosition: true },
    ];
    const back = collapseFromItems(expandToItems(wps, AP_COPTER));
    expect(back[1].frame).toBe("absolute");
    expect(back[0].param3).toBeUndefined();
    expect(expandToItems(back, AP_COPTER)[0].param4).toBeNaN();
  });

  it("reads ArduPilot's stored RTL (frame 0, 0 m) in the previous waypoint's frame, not as sea level", () => {
    const nav: MissionItem = { seq: 1, frame: 3, command: 16, current: 0, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: 360612000, y: -1121100000, z: 50 };
    const rtl: MissionItem = { ...nav, seq: 2, frame: 0, command: 20, x: 0, y: 0, z: 0 };
    const back = collapseFromItems([nav, rtl]);
    expect(back[1]).toMatchObject({ command: "RTL", frame: "relative", inheritsPosition: true });
  });

  it("maps DO_SET_ROI in location mode and DO_SET_ROI_LOCATION to the ROI action", () => {
    const nav: MissionItem = { seq: 0, frame: 3, command: 16, current: 1, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: 10000000, y: 20000000, z: 30 };
    const roi201: MissionItem = { ...nav, seq: 1, command: 201, param1: 3, x: 11000000 };
    const roi195: MissionItem = { ...nav, seq: 2, command: 195, param1: 0, x: 12000000 };
    const [wp] = collapseFromItems([nav, roi201, roi195]);
    expect(wp.actions?.map((a) => a.command)).toEqual(["ROI", "ROI"]);
    expect(expandToItems([wp], AP_COPTER).slice(1).map((it) => [it.command, it.param1])).toEqual([[195, 0], [195, 0]]);
  });

  it("carries autocontinue 0 through collapse and expand", () => {
    const wps: Waypoint[] = [{
      id: "a", lat: 1, lon: 2, alt: 30, autocontinue: false,
      actions: [{ id: "x", command: "DO_DIGICAM", param5: 1, autocontinue: false }],
    }];
    const items = expandToItems(wps, AP_COPTER);
    expect(items.map((it) => it.autocontinue)).toEqual([0, 0]);
    const back = collapseFromItems(items);
    expect(back[0].autocontinue).toBe(false);
    expect(back[0].actions?.[0].autocontinue).toBe(false);
    const plain = collapseFromItems(expandToItems([{ id: "b", lat: 1, lon: 2, alt: 30 }], AP_COPTER));
    expect(plain[0].autocontinue).toBeUndefined();
  });
});

describe("speed type", () => {
  it("a plane mission writes airspeed (param1 0), a copter ground speed, and both fold back", () => {
    const wps: Waypoint[] = [{ id: "a", lat: 1, lon: 2, alt: 100, speed: 20 }, { id: "b", lat: 1.01, lon: 2, alt: 100 }];
    const plane = expandToItems(wps, { ...AP_COPTER, vehicleClass: "plane" });
    expect(plane[0]).toMatchObject({ command: 178, param1: 0, param2: 20 });
    expect(expandToItems(wps, AP_COPTER)[0].param1).toBe(1);
    expect(collapseFromItems(plane)[0].speed).toBe(20);
  });
});

describe("PX4 specifics", () => {
  it("DELAY goes out as NAV_DELAY on PX4 and CONDITION_DELAY on ArduPilot, and folds back from PX4", () => {
    const wps: Waypoint[] = [{ id: "a", lat: 1, lon: 2, alt: 30, actions: [{ id: "d", command: "DELAY", param1: 4 }] }];
    const px4 = expandToItems(wps, { ...AP_COPTER, autopilot: "px4" });
    expect(px4[1]).toMatchObject({ command: 93, frame: 2, param1: 4, param2: -1 });
    expect(expandToItems(wps, AP_COPTER)[1].command).toBe(112);
    const back = collapseFromItems(px4, undefined, undefined, "px4");
    expect(back[0].actions?.[0]).toMatchObject({ command: "DELAY", param1: 4 });
    expect(collapseFromItems(px4)[0].actions?.[0].command).toBe("RAW");
  });

  it("refuses to encode a terrain-frame waypoint for PX4", () => {
    const wps: Waypoint[] = [{ id: "a", lat: 1, lon: 2, alt: 30, frame: "terrain" }];
    expect(() => missionUploadItems(wps, PX4_COPTER)).toThrow("PX4 has no terrain altitude frame");
    expect(() => missionUploadItems(wps, { autopilot: "ardupilot", vehicleClass: "copter" })).not.toThrow();
  });

  it("offers only the commands PX4 accepts, VTOL commands only on a VTOL", () => {
    const plane = new PX4Handler("plane").getSupportedMissionCommands();
    for (const refused of [18, 94, 183, 84, 85]) expect(plane).not.toContain(refused);
    expect(new PX4Handler("copter").getSupportedMissionCommands()).toContain(189);
    expect(new PX4Handler("vtol").getSupportedMissionCommands()).toEqual(expect.arrayContaining([84, 85]));
    for (const refused of ["CONDITION_YAW", "DO_FENCE_ENABLE", "DO_AUX_FUNCTION"] as const) {
      expect(px4AcceptedActions.has(refused)).toBe(false);
    }
    expect(px4AcceptedActions.has("PHOTO_INTERVAL")).toBe(true);
  });

  it("the PX4 demo vehicle refuses a forward DO_JUMP and VTOL items on a multirotor", async () => {
    const nav = (seq: number, command = 16): MissionItem =>
      ({ seq, frame: 3, command, current: 0, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: NaN, x: 1, y: 1, z: 10 });
    const fwd: MissionItem = { ...nav(1, 177), frame: 2, param1: 2, param2: 1 };
    expect((await new MockProtocol("px4").uploadMission([nav(0), fwd, nav(2)])).resultCode).toBe(6);
    expect((await new MockProtocol("px4").uploadMission([nav(0, 84)])).success).toBe(false);
    expect((await new MockProtocol("px4-vtol").uploadMission([nav(0, 84)])).success).toBe(true);
  });
});

describe("camera actions", () => {
  it("map to the image and video capture commands in frame 2", () => {
    const wps: Waypoint[] = [{
      id: "a", lat: 1, lon: 2, alt: 30,
      actions: [
        { id: "1", command: "PHOTO_INTERVAL", ...defaultActionParams("PHOTO_INTERVAL", { lat: 1, lon: 2 }) },
        { id: "2", command: "PHOTO_STOP" },
        { id: "3", command: "VIDEO_START" },
        { id: "4", command: "VIDEO_STOP" },
      ],
    }];
    const items = expandToItems(wps, AP_COPTER).slice(1);
    expect(items.map((it) => [it.command, it.frame])).toEqual([[2000, 2], [2001, 2], [2500, 2], [2501, 2]]);
    expect(items[0]).toMatchObject({ param2: 2, param3: 0 });
    expect(collapseFromItems(expandToItems(wps, AP_COPTER))[0].actions?.map((a) => a.command))
      .toEqual(["PHOTO_INTERVAL", "PHOTO_STOP", "VIDEO_START", "VIDEO_STOP"]);
  });
});

describe("planner defaults", () => {
  it("CONDITION_YAW turns the shortest way by default", () => {
    expect(defaultActionParams("CONDITION_YAW", { lat: 0, lon: 0 }).param3).toBe(0);
  });

  it("switching a waypoint with a 2 m acceptance radius to LAND clears every slot", () => {
    const update = commandChangeUpdate("LAND", 2);
    expect(update).toEqual({ command: "LAND", holdTime: undefined, param1: undefined, param2: undefined, param3: undefined });
    const wp: Waypoint = { id: "a", lat: 1, lon: 2, alt: 0, command: "WAYPOINT", param1: 2, holdTime: 5, ...update };
    expect(expandToItems([wp], AP_COPTER)[0]).toMatchObject({ command: 21, param1: 0, param2: 0 });
    expect(commandChangeUpdate("WAYPOINT", 3).param1).toBe(3);
  });

  it("the default acceptance radius leaves it to the flight controller", () => {
    expect(usePlannerStore.getInitialState().defaultAcceptRadius).toBe(0);
  });
});
