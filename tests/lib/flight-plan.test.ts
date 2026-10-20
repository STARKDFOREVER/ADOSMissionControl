import { describe, expect, it } from "vitest";
import type { Waypoint } from "@/lib/types";
import { computeFlightPlan } from "@/lib/flight-plan";
import { interpolatePosition } from "@/lib/simulation-utils";
import { haversineDistance } from "@/lib/geo/distance";

const HOME = { lat: 12.9716, lon: 77.5946 };
/** A point `m` metres north of HOME. */
const north = (m: number) => ({ lat: HOME.lat + m / 111_195, lon: HOME.lon });
const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  haversineDistance(a.lat, a.lon, b.lat, b.lon);

describe("computeFlightPlan altitude frames and vertical time", () => {
  it("counts horizontal distance only and times the climb at the climb rate", () => {
    // TAKEOFF relative 50 m at A; WP absolute 450 m at B, 100 m away; home ground 380 m.
    const b = north(100);
    const plan = computeFlightPlan(
      [
        { id: "t", ...HOME, alt: 50, command: "TAKEOFF", frame: "relative" },
        { id: "w", ...b, alt: 450, frame: "absolute" },
      ],
      20,
      { home: { ...HOME, groundAmsl: 380 } },
    );
    expect(plan.totalDistance).toBeCloseTo(dist(HOME, b), 6);
    const leg = plan.segments.find((s) => s.kind === "leg")!;
    // 100 m at 20 m/s is 5 s; the 20 m climb (50 → 70 above home) at 2.5 m/s is 8 s.
    expect(leg.duration).toBeCloseTo(8, 6);
    expect(leg.to.alt).toBeCloseTo(70, 6);
    // The takeoff climbs 50 m at 2.5 m/s first.
    expect(plan.segments[0].kind).toBe("climb");
    expect(plan.segments[0].duration).toBeCloseTo(20, 6);
    expect(plan.altitudesApproximate).toBe(false);
  });

  it("resolves an absolute default frame against home ground instead of descending to 0", () => {
    // Mission default absolute, ground 500 m MSL, flying at 520 m MSL: an RTL
    // descends 20 m, not 520 m.
    const far = north(500);
    const plan = computeFlightPlan(
      [
        { id: "t", ...HOME, alt: 520, command: "TAKEOFF" },
        { id: "w", ...far, alt: 520 },
        { id: "r", ...far, alt: 0, command: "RTL" },
      ],
      10,
      { home: { ...HOME, groundAmsl: 500 }, defaultFrame: "absolute", rtlAltM: 15 },
    );
    expect(plan.maxAboveHomeM).toBeCloseTo(20, 6);
    const descent = plan.segments.find((s) => s.kind === "descent")!;
    expect(descent.from.alt - descent.to.alt).toBeCloseTo(20, 6);
  });

  it("reports the highest point above home across frames, and flags unresolvable altitudes", () => {
    const resolved = computeFlightPlan(
      [
        { id: "a", ...HOME, alt: 60, frame: "relative" },
        { id: "b", ...north(200), alt: 420, frame: "absolute" },
      ],
      10,
      { home: { ...HOME, groundAmsl: 380 } },
    );
    expect(resolved.maxAboveHomeM).toBeCloseTo(60, 6);
    expect(resolved.altitudesApproximate).toBe(false);

    const unknownGround = computeFlightPlan(
      [
        { id: "a", ...HOME, alt: 60, frame: "relative" },
        { id: "b", ...north(200), alt: 420, frame: "absolute" },
      ],
      10,
      { home: HOME },
    );
    expect(unknownGround.altitudesApproximate).toBe(true);
  });
});

describe("computeFlightPlan takeoff and landing", () => {
  const survey = north(2000);
  const mission: Waypoint[] = [
    { id: "t", ...survey, alt: 60, command: "TAKEOFF" },
    { id: "w", ...north(2100), alt: 60 },
  ];

  it("climbs a copter straight up at home and flies home to the next item", () => {
    const plan = computeFlightPlan(mission, 10, { home: HOME });
    expect(plan.segments[0].kind).toBe("climb");
    expect(plan.segments[0].from.lat).toBeCloseTo(HOME.lat, 9);
    expect(plan.segments[0].duration).toBeCloseTo(60 / 2.5, 6);
    const out = plan.segments[1];
    expect(out.from.lat).toBeCloseTo(HOME.lat, 9);
    expect(out.distance).toBeCloseTo(dist(HOME, north(2100)), 3);
    expect(out.implicit).toBe(true);
  });

  it("starts a plane at home and climbs out toward the next item", () => {
    const plan = computeFlightPlan(mission, 20, { home: HOME, vehicleClass: "plane" });
    expect(plan.segments.some((s) => s.kind === "climb")).toBe(false);
    const out = plan.segments[0];
    expect(out.from).toEqual({ ...HOME, alt: 0 });
    expect(out.to.alt).toBe(60);
    expect(out.hoverTime).toBe(0);
  });

  it("flies a copter LAND across at altitude, then descends at the descent and landing speeds", () => {
    // LAND 300 m away from a 100 m cruise at 10 m/s: 30 s across, 90 m at
    // 1.5 m/s and the last 10 m at 0.5 m/s.
    const plan = computeFlightPlan(
      [
        { id: "a", ...HOME, alt: 100 },
        { id: "l", ...north(300), alt: 0, command: "LAND" },
      ],
      10,
      { home: HOME },
    );
    const across = plan.segments.find((s) => s.toIndex === 1 && s.kind === "leg")!;
    const descent = plan.segments.find((s) => s.kind === "descent")!;
    expect(across.duration).toBeCloseTo(dist(HOME, north(300)) / 10, 6);
    expect(across.to.alt).toBe(100);
    expect(descent.duration).toBeCloseTo(90 / 1.5 + 10 / 0.5, 6);
  });

  it("counts nothing after LAND or RTL", () => {
    const base: Waypoint[] = [
      { id: "a", ...HOME, alt: 30 },
      { id: "l", ...north(100), alt: 0, command: "LAND" },
    ];
    const extra: Waypoint[] = [...base, { id: "x", ...north(5000), alt: 30 }];
    expect(computeFlightPlan(extra, 10, { home: HOME }).totalDistance).toBeCloseTo(
      computeFlightPlan(base, 10, { home: HOME }).totalDistance,
      6,
    );
  });
});

describe("computeFlightPlan speed and holds", () => {
  it("carries an attached DO_SET_SPEED to every later leg until a waypoint sets its own", () => {
    const plan = computeFlightPlan(
      [
        { id: "w1", ...HOME, alt: 30, actions: [{ id: "s", command: "DO_SET_SPEED", param1: 1, param2: 3 }] },
        { id: "w2", ...north(300), alt: 30 },
        { id: "w3", ...north(600), alt: 30 },
        { id: "w4", ...north(900), alt: 30, speed: 8 },
      ],
      10,
      { home: HOME },
    );
    const into = (i: number) => plan.segments.find((s) => s.toIndex === i && s.kind === "leg")!;
    expect(into(1).speed).toBe(3);
    expect(into(2).speed).toBe(3);
    expect(into(3).speed).toBe(8);
  });

  it("skips the waypoint hold on fixed wing but keeps it on a multirotor", () => {
    const legs: Waypoint[] = [
      { id: "a", ...HOME, alt: 30, holdTime: 30 },
      { id: "b", ...north(200), alt: 30 },
    ];
    const copter = computeFlightPlan(legs, 10, { home: HOME });
    const plane = computeFlightPlan(legs, 10, { home: HOME, vehicleClass: "plane" });
    const copterHold = copter.segments.reduce((sum, s) => sum + s.holdTime, 0);
    const planeHold = plane.segments.reduce((sum, s) => sum + s.holdTime, 0);
    expect(copterHold).toBe(30);
    expect(planeHold).toBe(0);
  });

  it("times LOITER_TURNS as turns around the circle at the leg speed", () => {
    const loiter = (turns: number): Waypoint[] => [
      { id: "a", ...HOME, alt: 30 },
      { id: "b", ...north(100), alt: 30, command: "LOITER_TURNS", holdTime: turns, param2: 30 },
      { id: "c", ...north(200), alt: 30 },
    ];
    const none = computeFlightPlan(loiter(0), 5, { home: HOME }).totalDuration;
    const three = computeFlightPlan(loiter(3), 5, { home: HOME }).totalDuration;
    expect(three - none).toBeCloseTo((3 * 2 * Math.PI * 30) / 5, 6);
  });

  it("ends the estimate open-ended at an unlimited LOITER", () => {
    const plan = computeFlightPlan(
      [
        { id: "w1", ...HOME, alt: 30 },
        { id: "lo", ...north(200), alt: 30, command: "LOITER" },
        { id: "w3", ...north(5000), alt: 30 },
        { id: "r", ...north(5000), alt: 0, command: "RTL" },
      ],
      10,
      { home: HOME },
    );
    expect(plan.openEnded).toBe(true);
    expect(Math.max(...plan.segments.map((s) => s.toIndex))).toBe(1);
  });
});

describe("computeFlightPlan DO_LAND_START and DO_JUMP", () => {
  it("never flies to a DO_LAND_START marker", () => {
    const off = { lat: HOME.lat, lon: HOME.lon + 500 / 108_000 };
    const plain: Waypoint[] = [
      { id: "a", ...HOME, alt: 30 },
      { id: "b", ...north(300), alt: 30 },
    ];
    const marked: Waypoint[] = [plain[0], { id: "ls", ...off, alt: 30, command: "DO_LAND_START" }, plain[1]];
    expect(computeFlightPlan(marked, 10, { home: HOME }).totalDistance).toBeCloseTo(
      computeFlightPlan(plain, 10, { home: HOME }).totalDistance,
      6,
    );
  });

  it("unrolls a jump: repeat 3 flies the loop body four times", () => {
    const loop = (repeat: number): Waypoint[] => [
      { id: "a", ...HOME, alt: 30 },
      { id: "b", ...north(100), alt: 30 },
      { id: "c", ...north(200), alt: 30 },
      {
        id: "d", ...north(300), alt: 30,
        actions: [{ id: "j", command: "DO_JUMP", jumpTargetId: "a", param2: repeat }],
      },
    ];
    const once = computeFlightPlan(loop(0), 10, { home: HOME });
    const four = computeFlightPlan(loop(3), 10, { home: HOME });
    // Each repeat adds the 300 m back to "a" and the 300 m out again.
    expect(four.totalDistance - once.totalDistance).toBeCloseTo(3 * 2 * dist(HOME, north(300)), 3);
    expect(computeFlightPlan(loop(-1), 10, { home: HOME }).openEnded).toBe(true);
    // ArduPilot never takes a jump with repeat −2.
    expect(computeFlightPlan(loop(-2), 10, { home: HOME }).totalDistance).toBeCloseTo(once.totalDistance, 6);
  });
});

describe("computeFlightPlan RTL", () => {
  const far = north(2000);
  const mission: Waypoint[] = [
    { id: "t", ...HOME, alt: 30, command: "TAKEOFF" },
    { id: "w", ...far, alt: 30 },
    { id: "r", ...far, alt: 0, command: "RTL" },
  ];

  it("returns a copter home at the return altitude, loiters 5 s, then lands", () => {
    const plan = computeFlightPlan(mission, 10, { home: HOME, rtlAltM: 60 });
    const back = plan.segments.find((s) => s.kind === "return")!;
    expect(back.to.lat).toBeCloseTo(HOME.lat, 9);
    expect(back.to.alt).toBe(60);
    expect(back.implicit).toBe(true);
    const descent = plan.segments[plan.segments.length - 1];
    expect(descent.kind).toBe("descent");
    expect(descent.holdTime).toBe(5);
    expect(descent.duration).toBeCloseTo(5 + 50 / 1.5 + 10 / 0.5, 6);
    expect(plan.returnTarget?.kind).toBe("home");
    const end = interpolatePosition(plan.segments, mission, plan.totalDuration);
    expect(end.lat).toBeCloseTo(HOME.lat, 6);
    expect(end.alt).toBe(0);
  });

  it("returns to a rally point 200 m away on Copter", () => {
    const rally = { lat: far.lat + 200 / 111_195, lon: far.lon };
    const plan = computeFlightPlan(mission, 10, { home: HOME, rally: [rally] });
    expect(plan.returnTarget).toMatchObject({ kind: "rally", rallyIndex: 0 });
    const back = plan.segments.find((s) => s.kind === "return")!;
    expect(back.distance).toBeCloseTo(dist(far, rally), 3);
  });

  it("returns to the closest of rally points and home on PX4", () => {
    const rally = { lat: far.lat + 1000 / 111_195, lon: far.lon };
    const plan = computeFlightPlan(mission, 10, { home: HOME, rally: [rally], autopilot: "px4" });
    expect(plan.returnTarget).toMatchObject({ kind: "rally", rallyIndex: 0 });
  });

  it("caps the return altitude at the altitude fence ceiling", () => {
    const plan = computeFlightPlan(mission, 10, { home: HOME, rtlAltM: 120, returnCeilingM: 98 });
    expect(plan.segments.find((s) => s.kind === "return")!.to.alt).toBe(98);
  });

  it("leaves a plane loitering over home: open-ended", () => {
    const plan = computeFlightPlan(mission, 20, { home: HOME, vehicleClass: "plane", rtlAltM: 100 });
    expect(plan.openEnded).toBe(true);
    expect(plan.segments[plan.segments.length - 1].kind).toBe("return");
  });

  it("flies a plane's landing sequence from DO_LAND_START on RTL", () => {
    const withLanding: Waypoint[] = [
      { id: "t", ...HOME, alt: 30, command: "TAKEOFF" },
      { id: "w", ...far, alt: 60 },
      { id: "r", ...far, alt: 0, command: "RTL" },
      { id: "ls", ...north(1000), alt: 0, command: "DO_LAND_START" },
      { id: "app", ...north(500), alt: 30 },
      { id: "l", ...HOME, alt: 0, command: "LAND" },
    ];
    const plan = computeFlightPlan(withLanding, 20, { home: HOME, vehicleClass: "plane" });
    expect(plan.openEnded).toBe(false);
    expect(plan.segments[plan.segments.length - 1].toIndex).toBe(5);
  });

  it("uses the planned home as given, however far it is from the plan", () => {
    const workshop = north(-30_000);
    const plan = computeFlightPlan(mission, 10, { home: workshop });
    expect(plan.totalDistance).toBeGreaterThan(60_000);
  });
});

describe("computeFlightPlan ArduCopter altitude 0", () => {
  it("keeps the previous target altitude on a waypoint at 0", () => {
    const plan = computeFlightPlan(
      [
        { id: "a", ...HOME, alt: 40 },
        { id: "b", ...north(200), alt: 0 },
      ],
      10,
      { home: HOME },
    );
    expect(plan.segments[plan.segments.length - 1].to.alt).toBe(40);
    const px4 = computeFlightPlan(
      [
        { id: "a", ...HOME, alt: 40 },
        { id: "b", ...north(200), alt: 0 },
      ],
      10,
      { home: HOME, autopilot: "px4" },
    );
    expect(px4.segments[px4.segments.length - 1].to.alt).toBe(0);
  });
});

describe("computeFlightPlan transit altitude", () => {
  it("adds the climb over to the work area and back at the transit altitude", () => {
    const work = north(1000);
    const mission: Waypoint[] = [
      { id: "t", ...HOME, alt: 30, command: "TAKEOFF" },
      { id: "w1", ...work, alt: 40 },
      { id: "w2", ...north(1100), alt: 40 },
      { id: "r", ...north(1100), alt: 0, command: "RTL" },
    ];
    const plan = computeFlightPlan(mission, 10, { home: HOME, transitAltM: 120 });
    const transit = plan.segments.filter((s) => s.kind === "transit");
    expect(transit.length).toBe(2);
    expect(transit[0].to.alt).toBe(120);
    expect(transit[0].toIndex).toBe(1);
    expect(Math.max(...plan.segments.map((s) => s.toIndex))).toBe(3);
    expect(plan.maxAboveHomeM).toBe(120);
  });
});
