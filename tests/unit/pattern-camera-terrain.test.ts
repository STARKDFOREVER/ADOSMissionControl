import { describe, it, expect, vi, beforeEach } from "vitest";

// Ground rises 40 m west to east across ~1 km at 12.97 N (stubbed terrain).
const groundAt = (lon: number) => 100 + 40 * Math.min(1, Math.max(0, (lon - 77.59) / 0.0092));
const sampler = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/terrain/ground-sampler", () => ({
  sampleGroundAlong: vi.fn(async (a: { lat: number; lon: number }, b: { lat: number; lon: number }, spacingM = 30) => {
    // Flat-earth leg length is plenty for a ~1 km stub (the factory cannot use module imports).
    const k = (Math.PI / 180) * 6371008.8;
    const len = Math.hypot((b.lat - a.lat) * k, (b.lon - a.lon) * k * Math.cos((a.lat * Math.PI) / 180));
    const n = Math.max(1, Math.ceil(len / spacingM));
    return Array.from({ length: n + 1 }, (_, i) => ({
      distM: (len * i) / n,
      groundAmsl: sampler.fail ? null : groundAt(a.lon + ((b.lon - a.lon) * i) / n),
    }));
  }),
}));

import { generateFacade } from "@/lib/patterns/facade-generator";
import { generateSurvey } from "@/lib/patterns/survey-generator";
import { generateStructureScan } from "@/lib/patterns/structure-scan-generator";
import { generateOrbit } from "@/lib/patterns/orbit-generator";
import { followTerrain, withTerrainFrame } from "@/lib/patterns/follow-terrain";
import { patternToMission } from "@/lib/patterns/pattern-to-mission";
import { computeFootprint, CAMERA_PROFILES, validateCameraProfile } from "@/lib/patterns/gsd-calculator";
import { offsetPoint, bearing } from "@/lib/drawing/geo-utils";
import { haversineDistance } from "@/lib/geo/distance";
import { SURVEY_PRESETS } from "@/components/planner/pattern-editor-constants";
import { formatPatternTime } from "@/components/planner/PatternEditor";
import { cameraSpacingUpdate } from "@/components/planner/pattern-camera";
import { useSettingsStore } from "@/stores/settings-store";
import { migrateSettings } from "@/stores/settings-store/migrations";

beforeEach(() => { sampler.fail = false; });

describe("facade scan", () => {
  const a: [number, number] = [12.97, 77.59];
  const b = offsetPoint(a[0], a[1], 90, 100); // 100 m east
  const result = generateFacade({
    pathPoints: [a, b], side: "left", distance: 15, bottomAlt: 20, topAlt: 40,
    rowSpacing: 10, cameraTriggerDistance: 25, speed: 3,
  });
  const nav = result.waypoints.filter((w) => w.command === "WAYPOINT");

  it("flies horizontal rows from 20 to 40 m on the chosen side, alternating direction", () => {
    expect(result.stats.transectCount).toBe(3);
    expect([...new Set(nav.map((w) => w.alt))]).toEqual([20, 30, 40]);
    // Left of an eastward line is north, 15 m off.
    for (const w of nav) expect((w.lat - a[0]) * 111195).toBeCloseTo(15, 0);
    const rowOf = (alt: number) => nav.filter((w) => w.alt === alt);
    expect(rowOf(20)[0].lon).toBeLessThan(rowOf(20).at(-1)!.lon);
    expect(rowOf(30)[0].lon).toBeGreaterThan(rowOf(30).at(-1)!.lon);
  });

  it("aims an ROI at each waypoint's foot on the facade, at its altitude, before the waypoint", () => {
    const rows = result.waypoints;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].command !== "WAYPOINT") continue;
      const roi = rows[i - 1];
      expect(roi.command).toBe("ROI");
      expect(roi.alt).toBe(rows[i].alt);
      expect(roi.lat).toBeCloseTo(a[0], 6);
      expect(roi.lon).toBeCloseTo(rows[i].lon, 6);
    }
    expect(rows.filter((r) => r.command === "DO_MOUNT_CONTROL").map((r) => r.param1)).toEqual([0]);
  });
});

describe("follow terrain", () => {
  const box = (): [number, number][] => [[12.97, 77.59], [12.97, 77.5992], [12.9709, 77.5992], [12.9709, 77.59]];

  it("holds the height above a 40 m slope within the tolerance, in absolute altitudes", async () => {
    const survey = generateSurvey({
      polygon: box(), gridAngle: 90, lineSpacing: 50, turnAroundDistance: 0, entryLocation: "topLeft",
      flyAlternateTransects: false, cameraTriggerDistance: 0, altitude: 50, speed: 5,
    });
    const outcome = await followTerrain(survey, { toleranceM: 3, maxClimbMps: 10, maxDescentMps: 10 }, 30);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const nav = outcome.result.waypoints.filter((w) => w.command === "WAYPOINT");
    expect(nav.every((w) => w.frame === "absolute")).toBe(true);
    // The line climbs with the ground: ~40 m between its west and east ends.
    expect(Math.abs(nav[1].alt - nav[0].alt)).toBeGreaterThan(35);
    for (let i = 1; i < nav.length; i++) {
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        const lon = nav[i - 1].lon + (nav[i].lon - nav[i - 1].lon) * t;
        const alt = nav[i - 1].alt + (nav[i].alt - nav[i - 1].alt) * t;
        expect(Math.abs(alt - groundAt(lon) - 50)).toBeLessThanOrEqual(3 + 1e-6);
      }
    }
  });

  it("never asks for a climb steeper than the limit, by starting it earlier", async () => {
    const survey = generateSurvey({
      polygon: box(), gridAngle: 90, lineSpacing: 200, turnAroundDistance: 0, entryLocation: "topLeft",
      flyAlternateTransects: false, cameraTriggerDistance: 0, altitude: 50, speed: 10,
    });
    const outcome = await followTerrain(survey, { toleranceM: 1, maxClimbMps: 0.2, maxDescentMps: 5 }, 30);
    if (!outcome.ok) throw new Error("expected terrain");
    const nav = outcome.result.waypoints.filter((w) => w.command === "WAYPOINT");
    for (let i = 1; i < nav.length; i++) {
      const d = haversineDistance(nav[i - 1].lat, nav[i - 1].lon, nav[i].lat, nav[i].lon);
      expect(nav[i].alt - nav[i - 1].alt).toBeLessThanOrEqual((0.2 * d) / 10 + 1.01);
      expect(nav[i].alt - groundAt(nav[i].lon)).toBeGreaterThanOrEqual(50 - 1e-6);
    }
  });

  it("fails the whole pattern when the ground is unknown", async () => {
    sampler.fail = true;
    const survey = generateSurvey({
      polygon: box(), gridAngle: 90, lineSpacing: 50, turnAroundDistance: 0, entryLocation: "topLeft",
      flyAlternateTransects: false, cameraTriggerDistance: 0, altitude: 50, speed: 5,
    });
    expect(await followTerrain(survey, undefined, 30)).toEqual({ ok: false, reason: "terrainUnavailable" });
  });

  it("stamps the terrain frame onto every applied waypoint", () => {
    const survey = generateSurvey({
      polygon: box(), gridAngle: 90, lineSpacing: 50, turnAroundDistance: 0, entryLocation: "topLeft",
      flyAlternateTransects: false, cameraTriggerDistance: 0, altitude: 50, speed: 5,
    });
    const mission = patternToMission(withTerrainFrame(survey).waypoints);
    expect(mission.filter((w) => w.command === "WAYPOINT").every((w) => w.frame === "terrain")).toBe(true);
  });
});

describe("structure scan", () => {
  it("flies the outline offset by the scan distance, not a circle around the farthest corner", () => {
    // A 100 x 10 m building, scan distance 15 m.
    const lat0 = 12.97;
    const lon0 = 77.59;
    const dLon = 50 / (111195 * Math.cos((lat0 * Math.PI) / 180));
    const dLat = 5 / 111195;
    const result = generateStructureScan({
      structurePolygon: [[lat0 - dLat, lon0 - dLon], [lat0 - dLat, lon0 + dLon], [lat0 + dLat, lon0 + dLon], [lat0 + dLat, lon0 - dLon]],
      bottomAlt: 10, topAlt: 10, layerSpacing: 10, scanDistance: 15, gimbalPitch: 0, pointsPerLayer: 16,
      cameraTriggerDistance: 0, speed: 3, direction: "bottom-up",
    });
    const nav = result.waypoints.filter((w) => w.command === "WAYPOINT");
    // Points along the long walls sit 15 m off them (5 m half-width + 15 m from the centre line).
    const longWall = nav.filter((w) => Math.abs(w.lon - lon0) < dLon * 0.8);
    expect(longWall.length).toBeGreaterThan(0);
    for (const w of longWall) expect(Math.abs(w.lat - lat0) * 111195).toBeCloseTo(20, 0);
    expect(haversineDistance(nav[0].lat, nav[0].lon, nav.at(-1)!.lat, nav.at(-1)!.lon)).toBeLessThan(0.01);
  });
});

describe("orbit", () => {
  it("closes on its first point, so the whole circle is flown and counted", () => {
    const result = generateOrbit({ center: [12.97, 77.59], radius: 50, direction: "cw", turns: 1, startAngle: 0, altitude: 50, speed: 5 });
    const nav = result.waypoints.filter((w) => w.command === "WAYPOINT");
    expect(nav[0]).toMatchObject({ lat: nav.at(-1)!.lat, lon: nav.at(-1)!.lon });
    let flown = 0;
    for (let i = 1; i < nav.length; i++) flown += haversineDistance(nav[i - 1].lat, nav[i - 1].lon, nav[i].lat, nav[i].lon);
    expect(result.stats.totalDistance).toBeCloseTo(flown, 6);
  });
});

describe("cameras", () => {
  const generic = CAMERA_PROFILES.find((c) => c.name === 'Generic 1/2.3"')!;

  it("portrait swaps the across- and along-track footprint", () => {
    const land = computeFootprint(50, generic);
    const port = computeFootprint(50, generic, "portrait");
    expect(port.width).toBeCloseTo(land.height, 9);
    expect(port.height).toBeCloseTo(land.width, 9);
  });

  it("derives wall spacings for structure and facade from the footprint at the wall distance", () => {
    const { width, height } = computeFootprint(20, generic);
    expect(cameraSpacingUpdate("facade", generic, 20, 60, 70)).toEqual({
      rowSpacing: Math.round(height * 0.4 * 10) / 10, cameraTriggerDistance: Math.round(width * 0.3 * 10) / 10,
    });
    expect(cameraSpacingUpdate("structure", generic, 20, 60, 70)).toEqual({
      layerSpacing: Math.round(height * 0.3 * 10) / 10, cameraTriggerDistance: Math.round(width * 0.4 * 10) / 10,
    });
  });

  it("rejects a custom camera with a zero dimension or focal length", () => {
    expect(validateCameraProfile({ ...generic, name: "X", sensorWidth: 0, focalLength: 0 })).toEqual(["sensor", "focal"]);
    expect(validateCameraProfile({ ...generic, name: "X" })).toEqual([]);
  });

  it("stores custom cameras in settings, unique by name, and migrates older settings to none", () => {
    const s = useSettingsStore.getState();
    s.addCustomCamera({ ...generic, name: "Mine" });
    s.addCustomCamera({ ...generic, name: "Mine", focalLength: 8 });
    expect(useSettingsStore.getState().customCameras).toHaveLength(1);
    s.updateCustomCamera("Mine", { ...generic, name: "Renamed" });
    expect(useSettingsStore.getState().customCameras.map((c) => c.name)).toEqual(["Renamed"]);
    s.removeCustomCamera("Renamed");
    expect(useSettingsStore.getState().customCameras).toEqual([]);
    expect(migrateSettings({}, 54).customCameras).toEqual([]);
  });

  it("presets put front overlap above side overlap", () => {
    const std = SURVEY_PRESETS.find((p) => p.label === "Photogrammetry Standard")!;
    const quick = SURVEY_PRESETS.find((p) => p.label === "Quick Overview")!;
    expect([std.frontlap, std.sidelap]).toEqual([80, 70]);
    expect([quick.frontlap, quick.sidelap]).toEqual([75, 60]);
  });
});

describe("pattern stats", () => {
  it("formats time from the rounded total, never 1m 60s", () => {
    expect(formatPatternTime(119.6)).toBe("2m 0s");
    expect(formatPatternTime(61.2)).toBe("1m 1s");
  });

  it("hover-and-capture survey stops at each photo point instead of arming a trigger", () => {
    const survey = generateSurvey({
      polygon: [[12.97, 77.59], [12.97, 77.5919], [12.9709, 77.5919], [12.9709, 77.59]],
      gridAngle: 90, lineSpacing: 50, turnAroundDistance: 10, entryLocation: "topLeft",
      flyAlternateTransects: false, cameraTriggerDistance: 50, altitude: 50, speed: 5, hoverAndCapture: true,
    });
    const mission = patternToMission(survey.waypoints);
    const work = mission.filter((w) => w.command === "WAYPOINT");
    expect(work.every((w) => w.holdTime === 1)).toBe(true);
    expect(work.every((w) => w.actions?.some((a) => a.command === "DO_DIGICAM" && a.param5 === 1))).toBe(true);
    expect(mission.some((w) => w.actions?.some((a) => a.command === "DO_SET_CAM_TRIGG"))).toBe(false);
    // No turn-around overshoot: the first capture is on the boundary.
    expect(bearing(work[0].lat, work[0].lon, work[1].lat, work[1].lon)).toBeCloseTo(90, 0);
  });
});
