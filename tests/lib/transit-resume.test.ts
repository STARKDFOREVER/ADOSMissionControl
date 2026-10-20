import { describe, expect, it } from "vitest";
import type { Waypoint } from "@/lib/types";
import { applyTransit } from "@/lib/mission/transit";
import { buildResumeMission } from "@/lib/mission/resume";

const HOME = { lat: 12.9716, lon: 77.5946 };
const north = (m: number) => ({ lat: HOME.lat + m / 111_195, lon: HOME.lon });

describe("applyTransit", () => {
  const mission: Waypoint[] = [
    { id: "t", ...HOME, alt: 30, command: "TAKEOFF" },
    { id: "w1", ...north(1000), alt: 40 },
    { id: "w2", ...north(1100), alt: 40 },
    { id: "r", ...north(1100), alt: 0, command: "RTL" },
  ];

  it("inserts exactly the outbound and return transit waypoints and raises the takeoff", () => {
    const out = applyTransit(mission, 120);
    expect(out.map((w) => w.id)).toEqual(["t", "t-transit-out", "w1", "w2", "t-transit-back", "r"]);
    expect(out[0].alt).toBe(120);
    expect(out[1]).toMatchObject({ command: "WAYPOINT", frame: "relative", alt: 120, lat: mission[1].lat, lon: mission[1].lon });
    expect(out[4]).toMatchObject({ alt: 120, lat: mission[2].lat, lon: mission[2].lon });
    // The planner list is untouched.
    expect(mission).toHaveLength(4);
    expect(mission[0].alt).toBe(30);
  });

  it("is a no-op without a TAKEOFF, with transit off, or at 0", () => {
    const noTakeoff = mission.slice(1);
    expect(applyTransit(noTakeoff, 120)).toBe(noTakeoff);
    expect(applyTransit(mission, null)).toBe(mission);
    expect(applyTransit(mission, 0)).toBe(mission);
  });

  it("skips an insertion when the neighbouring work waypoint already flies at or above it", () => {
    const high: Waypoint[] = mission.map((w) => (w.id === "w1" ? { ...w, alt: 150 } : w));
    expect(applyTransit(high, 120).map((w) => w.id)).toEqual(["t", "w1", "w2", "t-transit-back", "r"]);
  });

  it("adds no return leg when the plan ends without RTL or LAND", () => {
    const open = mission.slice(0, 3);
    expect(applyTransit(open, 120).map((w) => w.id)).toEqual(["t", "t-transit-out", "w1", "w2"]);
  });
});

describe("buildResumeMission", () => {
  const mission: Waypoint[] = [
    { id: "t", ...HOME, alt: 30, command: "TAKEOFF", actions: [{ id: "g", command: "DO_MOUNT_CONTROL", param1: -90 }] },
    { id: "w1", ...north(100), alt: 50, actions: [{ id: "cam", command: "DO_SET_CAM_TRIGG", param1: 25 }] },
    { id: "w2", ...north(200), alt: 50, actions: [{ id: "spd", command: "DO_SET_SPEED", param1: 1, param2: 7 }] },
    { id: "w3", ...north(300), alt: 50 },
    { id: "w4", ...north(400), alt: 50 },
    { id: "r", ...north(400), alt: 0, command: "RTL" },
  ];

  it("takes off, restores speed and camera at the waypoint before, then continues unchanged", () => {
    const out = buildResumeMission(mission, 4, { takeoffAltM: 25, speedMps: 5 });
    expect(out.map((w) => w.id)).toEqual(["t-resume-takeoff", "w3-resume", "w4", "r"]);
    expect(out[0]).toMatchObject({ command: "TAKEOFF", alt: 30, lat: HOME.lat });
    expect(out[0].actions).toBeUndefined();
    expect(out[1]).toMatchObject({ lat: mission[3].lat, lon: mission[3].lon, alt: 50 });
    expect(out[1].actions).toEqual([
      { id: "w3-resume-speed", command: "DO_SET_SPEED", param1: 1, param2: 7, param3: -1 },
      { id: "w3-resume-camera", command: "DO_SET_CAM_TRIGG", param1: 25 },
    ]);
    expect(out[2]).toBe(mission[4]);
  });

  it("synthesizes a TAKEOFF when the plan has none and restores the default speed", () => {
    const noTakeoff = mission.slice(1).map((w) => ({ ...w, actions: undefined }));
    const out = buildResumeMission(noTakeoff, 2, { takeoffAltM: 25, speedMps: 5, vehicleClass: "plane" });
    expect(out[0]).toMatchObject({ command: "TAKEOFF", alt: 25, frame: "relative", lat: noTakeoff[1].lat });
    expect(out[1].actions).toEqual([
      { id: "w2-resume-speed", command: "DO_SET_SPEED", param1: 0, param2: 5, param3: -1 },
    ]);
  });

  it("drops a camera trigger that was stopped before the resume point", () => {
    const stopped = mission.map((w) =>
      w.id === "w2" ? { ...w, actions: [{ id: "off", command: "DO_SET_CAM_TRIGG" as const, param1: 0 }] } : w,
    );
    const out = buildResumeMission(stopped, 4, { takeoffAltM: 25, speedMps: 5 });
    expect(out[1].actions?.map((a) => a.command)).toEqual(["DO_SET_SPEED"]);
  });

  it("rejects a resume index outside the plan", () => {
    expect(() => buildResumeMission(mission, 0, { takeoffAltM: 25, speedMps: 5 })).toThrow(RangeError);
    expect(() => buildResumeMission(mission, mission.length, { takeoffAltM: 25, speedMps: 5 })).toThrow(RangeError);
  });
});
