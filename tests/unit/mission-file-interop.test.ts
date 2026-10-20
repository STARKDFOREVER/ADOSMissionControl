/**
 * @module mission-file-interop.test
 * @description `.plan` and `.waypoints` files read and written the way QGC,
 * Mission Planner and the autopilots read them: missing altitudes, NaN
 * parameters, autocontinue, file versions, the planned home, altitude modes,
 * vehicle type and mission-start items.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/download", () => ({ downloadBlob: vi.fn() }));

import { downloadBlob } from "@/lib/download";
import {
  exportQGCPlan,
  exportWaypointsFormat,
  parseQGCPlan,
  parseWaypointsFile,
} from "@/lib/mission-io-formats";
import { currentExportOptions } from "@/lib/mission-io";
import { useMissionStore } from "@/stores/mission-store";
import type { Waypoint } from "@/lib/types";

/** The text the last export handed to the download. */
async function lastExport(): Promise<string> {
  const blob = vi.mocked(downloadBlob).mock.calls.at(-1)?.[0];
  if (!blob) throw new Error("nothing was exported");
  return blob.text();
}

interface PlanItemJson {
  command: number;
  frame: number;
  params: Array<number | null>;
  autoContinue: boolean;
  AltitudeMode?: number;
  Altitude?: number;
  AMSLAltAboveTerrain?: null;
}

interface PlanJson {
  mission: {
    items: PlanItemJson[];
    plannedHomePosition: number[];
    firmwareType: number;
    vehicleType: number;
    cruiseSpeed?: number;
    hoverSpeed?: number;
    globalPlanAltitudeMode: number;
  };
}

function planFile(items: unknown[], mission: Record<string, unknown> = {}): string {
  return JSON.stringify({ fileType: "Plan", version: 1, mission: { version: 2, items, ...mission } });
}

const simple = (command: number, params: Array<number | null>, extra: Record<string, unknown> = {}) => ({
  type: "SimpleItem", command, frame: 3, params, autoContinue: true, ...extra,
});

const tabRow = (cols: Array<string | number>) => cols.join("\t");

beforeEach(() => {
  vi.mocked(downloadBlob).mockClear();
});

describe(".plan altitude, NaN and autocontinue", () => {
  it("refuses an item whose altitude QGC left null instead of placing it at 0 m above sea level", () => {
    const text = planFile([
      { type: "SimpleItem", command: 16, frame: 0, AltitudeMode: 3, Altitude: 40, params: [0, 0, 0, null, 47.39, 8.54, null], autoContinue: true },
    ]);
    expect(() => parseQGCPlan(text)).toThrow(
      "Item 1 has no altitude (calculated-above-terrain plans need QGC to fill altitudes first)",
    );
  });

  it("keeps a null heading as 'no heading' and writes it back as null", async () => {
    const { waypoints } = parseQGCPlan(planFile([simple(16, [0, 0, 0, null, 47.39, 8.54, 50])]));
    expect(waypoints[0].param3).toBeUndefined();
    exportQGCPlan(waypoints, "nan");
    const plan = JSON.parse(await lastExport()) as PlanJson;
    expect(plan.mission.items[0].params[3]).toBeNull();
  });

  it("keeps NaN 'ignore' slots of a command the planner does not model", async () => {
    const { waypoints } = parseQGCPlan(planFile([
      simple(16, [0, 0, 0, 0, 47.39, 8.54, 50]),
      simple(187, [1, null, null, null, null, null, 0], { frame: 2 }),
    ]));
    exportQGCPlan(waypoints, "actuator");
    const plan = JSON.parse(await lastExport()) as PlanJson;
    expect(plan.mission.items.find((i) => i.command === 187)?.params).toEqual([1, null, null, null, null, null, 0]);
  });

  it("keeps autoContinue false through import and export", async () => {
    const { waypoints } = parseQGCPlan(planFile([
      simple(16, [0, 0, 0, 0, 47.39, 8.54, 50], { autoContinue: false }),
      simple(16, [0, 0, 0, 0, 47.4, 8.55, 50]),
    ]));
    expect(waypoints[0].autocontinue).toBe(false);
    expect(waypoints[1].autocontinue).toBeUndefined();
    exportQGCPlan(waypoints, "hold");
    const plan = JSON.parse(await lastExport()) as PlanJson;
    expect(plan.mission.items.map((i) => i.autoContinue)).toEqual([false, true]);
  });
});

describe(".plan altitude mode, vehicle and speed", () => {
  const mission: Waypoint[] = [
    { id: "a", lat: 47.39, lon: 8.54, alt: 30, command: "WAYPOINT", frame: "terrain" },
    { id: "b", lat: 47.4, lon: 8.55, alt: 30, command: "WAYPOINT", frame: "terrain" },
  ];

  it("writes AltitudeMode, Altitude and AMSLAltAboveTerrain so QGC shows a terrain-frame waypoint as terrain", async () => {
    exportQGCPlan(mission, "terrain");
    const plan = JSON.parse(await lastExport()) as PlanJson;
    const item = plan.mission.items[0];
    expect(item.AltitudeMode).toBe(4);
    expect(item.Altitude).toBe(30);
    expect(item.AMSLAltAboveTerrain).toBeNull();
    expect(plan.mission.globalPlanAltitudeMode).toBe(4);
  });

  it("writes globalPlanAltitudeMode 0 when the plan mixes altitude modes", async () => {
    exportQGCPlan([...mission, { id: "c", lat: 47.41, lon: 8.56, alt: 60, command: "WAYPOINT", frame: "relative" }], "mixed");
    const plan = JSON.parse(await lastExport()) as PlanJson;
    expect(plan.mission.items.map((i) => i.AltitudeMode)).toEqual([4, 4, 1]);
    expect(plan.mission.globalPlanAltitudeMode).toBe(0);
  });

  it("names a PX4 VTOL plan as PX4 VTOL with the mission speed, and reads it back", async () => {
    exportQGCPlan(mission, "vtol", undefined, { vehicle: { autopilot: "px4", vehicleClass: "vtol" }, defaultSpeed: 7 });
    const text = await lastExport();
    const plan = JSON.parse(text) as PlanJson;
    expect(plan.mission.firmwareType).toBe(12);
    expect(plan.mission.vehicleType).toBe(20);
    expect(plan.mission.cruiseSpeed).toBe(7);
    expect(plan.mission.hoverSpeed).toBe(7);
    expect(parseQGCPlan(text).settings?.vehicle).toEqual({ autopilot: "px4", vehicleClass: "vtol" });
  });

  it("maps an ArduPilot fixed-wing plan back to a plane profile", () => {
    const parsed = parseQGCPlan(planFile([simple(16, [0, 0, 0, 0, 47.39, 8.54, 50])], { firmwareType: 3, vehicleType: 1 }));
    expect(parsed.settings?.vehicle).toEqual({ autopilot: "ardupilot", vehicleClass: "plane" });
  });
});

describe(".plan round trip of plan settings", () => {
  it("keeps the planned home, vehicle, altitude mode, a missing heading and autocontinue off", async () => {
    const mission: Waypoint[] = [
      { id: "t", lat: 47.39, lon: 8.54, alt: 20, command: "TAKEOFF", frame: "relative" },
      { id: "w", lat: 47.4, lon: 8.55, alt: 30, command: "WAYPOINT", frame: "terrain", autocontinue: false },
      { id: "r", lat: 47.4, lon: 8.55, alt: 0, command: "RTL" },
    ];
    exportQGCPlan(mission, "roundtrip", undefined, {
      home: { lat: 47.385, lon: 8.535, groundAmsl: 412 },
      vehicle: { autopilot: "px4", vehicleClass: "copter" },
      defaultFrame: "relative",
    });
    const text = await lastExport();
    const plan = JSON.parse(text) as PlanJson;
    expect(plan.mission.plannedHomePosition).toEqual([47.385, 8.535, 412]);
    expect(plan.mission.items[1].AltitudeMode).toBe(4);
    expect(plan.mission.items[1].params[3]).toBeNull();

    const back = parseQGCPlan(text);
    expect(back.settings).toEqual({
      plannedHome: { lat: 47.385, lon: 8.535, groundAmsl: 412 },
      vehicle: { autopilot: "px4", vehicleClass: "copter" },
    });
    const wp = back.waypoints.find((w) => w.command === "WAYPOINT");
    expect(wp?.frame).toBe("terrain");
    expect(wp?.param3).toBeUndefined();
    expect(wp?.autocontinue).toBe(false);
  });

  it("reads a home written at 0 m as ground unknown", () => {
    const parsed = parseQGCPlan(planFile([simple(16, [0, 0, 0, 0, 47.39, 8.54, 50])], { plannedHomePosition: [47.38, 8.53, 0] }));
    expect(parsed.settings?.plannedHome).toEqual({ lat: 47.38, lon: 8.53 });
  });
});

describe(".plan mission-start items and complex items", () => {
  it("keeps QGC's mission-start speed and camera items instead of dropping them", () => {
    const parsed = parseQGCPlan(planFile([
      simple(178, [0, 18, -1, 0, 0, 0, 0], { frame: 2 }),
      simple(203, [0, 0, 0, 0, 1, 0, 0], { frame: 2 }),
      simple(22, [0, 0, 0, 0, 47.39, 8.54, 40]),
      simple(16, [0, 0, 0, 0, 47.4, 8.55, 40]),
    ], { firmwareType: 3, vehicleType: 1 }));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.waypoints[0].command).toBe("TAKEOFF");
    expect(parsed.waypoints[0].speed).toBe(18);
    expect(parsed.waypoints[0].actions?.map((a) => a.command)).toEqual(["DO_DIGICAM"]);
  });

  it("skips a structure scan or landing pattern with a warning instead of refusing the file", () => {
    const parsed = parseQGCPlan(planFile([
      simple(22, [0, 0, 0, 0, 47.39, 8.54, 40]),
      { type: "ComplexItem", complexItemType: "StructureScan", version: 3 },
      { type: "ComplexItem", complexItemType: "fwLandingPattern", version: 2 },
    ]));
    expect(parsed.waypoints).toHaveLength(1);
    expect(parsed.warnings).toEqual([
      "Skipped StructureScan: re-create it in the planner",
      "Skipped fwLandingPattern: re-create it in the planner",
    ]);
  });
});

describe(".waypoints versions, home row and flags", () => {
  const home = tabRow([0, 1, 0, 16, 0, 0, 0, 0, -35.3632621, 149.1652374, 584, 1]);

  it("refuses a QGC WPL 100 file, whose columns are laid out differently", () => {
    const text = ["QGC WPL 100", tabRow([0, 0, 3, 16, 0, 0, 0, 0, 149.1652374, -35.3632621, 50])].join("\n");
    expect(() => parseWaypointsFile(text)).toThrow("Unsupported waypoint file version 100");
  });

  it("reads a QGC WPL 120 file's row 0 as the first item and shifts its jump targets", () => {
    const text = [
      "QGC WPL 120",
      tabRow([0, 1, 3, 16, 0, 0, 0, 0, -35.36, 149.16, 30, 1]),
      tabRow([1, 0, 3, 16, 0, 0, 0, 0, -35.37, 149.17, 30, 1]),
      tabRow([2, 0, 0, 177, 0, 2, 0, 0, 0, 0, 0, 1]),
    ].join("\n");
    const { waypoints } = parseWaypointsFile(text);
    expect(waypoints).toHaveLength(2);
    expect(waypoints[0].lat).toBeCloseTo(-35.36);
    const jump = waypoints[1].actions?.[0];
    expect(jump?.command === "DO_JUMP" ? jump.jumpTargetId : undefined).toBe(waypoints[0].id);
  });

  it("uses the home row as the planned home and places a 0,0 takeoff there", () => {
    const text = [
      "QGC WPL 110",
      home,
      tabRow([1, 0, 3, 22, 0, 0, 0, 0, 0, 0, 20, 1]),
      tabRow([2, 0, 3, 16, 0, 0, 0, 0, -35.36, 149.17, 50, 1]),
    ].join("\r\n");
    const parsed = parseWaypointsFile(text);
    expect(parsed.settings?.plannedHome).toEqual({ lat: -35.3632621, lon: 149.1652374, groundAmsl: 584 });
    expect(parsed.waypoints[0].command).toBe("TAKEOFF");
    expect(parsed.waypoints[0].lat).toBeCloseTo(-35.3632621);
    expect(parsed.waypoints[0].lon).toBeCloseTo(149.1652374);
  });

  it("reads NaN and autocontinue 0 and writes them back", async () => {
    const text = [
      "QGC WPL 110",
      home,
      tabRow([1, 0, 3, 16, 0, 0, 0, "NaN", -35.36, 149.17, 50, 0]),
    ].join("\n");
    const { waypoints } = parseWaypointsFile(text);
    expect(waypoints[0].param3).toBeUndefined();
    expect(waypoints[0].autocontinue).toBe(false);
    exportWaypointsFormat(waypoints, "nan");
    const row = (await lastExport()).split("\n")[2].split("\t");
    expect(row[7]).toBe("NaN");
    expect(row[11]).toBe("0");
  });

  it("flags the home row current and every mission row not current", async () => {
    exportWaypointsFormat([
      { id: "a", lat: 12.9, lon: 77.5, alt: 20, command: "TAKEOFF" },
      { id: "b", lat: 12.91, lon: 77.51, alt: 50, command: "WAYPOINT" },
    ], "flags");
    const rows = (await lastExport()).split("\n").slice(1).map((r) => r.split("\t"));
    expect(rows.map((r) => r[1])).toEqual(["1", "0", "0"]);
  });

  it("without a planned home, writes the plan's launch point at 0 m rather than a 0,0 first entry", async () => {
    exportWaypointsFormat([
      { id: "t", lat: 0, lon: 0, alt: 20, command: "TAKEOFF", inheritsPosition: true },
      { id: "w", lat: 12.9, lon: 77.5, alt: 50, command: "WAYPOINT" },
    ], "launch");
    const homeRow = (await lastExport()).split("\n")[1].split("\t");
    expect(homeRow.slice(8, 11)).toEqual(["12.9", "77.5", "0"]);
  });

  it("writes the planned home with its ground elevation", async () => {
    exportWaypointsFormat(
      [{ id: "w", lat: 12.9, lon: 77.5, alt: 50, command: "WAYPOINT" }],
      "home",
      { home: { lat: 12.89, lon: 77.49, groundAmsl: 912 } },
    );
    const homeRow = (await lastExport()).split("\n")[1].split("\t");
    expect(homeRow.slice(8, 11)).toEqual(["12.89", "77.49", "912"]);
  });
});

describe("currentExportOptions", () => {
  it("exports the plan's planned home and vehicle profile, and a saved plan's own settings", () => {
    useMissionStore.setState({
      plannedHome: { lat: 36.1, lon: -112.1, groundAmsl: 2100 },
      vehicleProfile: { autopilot: "px4", vehicleClass: "plane" },
    });
    expect(currentExportOptions()).toMatchObject({
      home: { lat: 36.1, lon: -112.1, groundAmsl: 2100 },
      vehicle: { autopilot: "px4", vehicleClass: "plane" },
    });
    const saved = currentExportOptions({});
    expect(saved.home).toBeUndefined();
    expect(saved.vehicle).toBeUndefined();
  });
});
