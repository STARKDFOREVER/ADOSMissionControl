import { describe, it, expect } from "vitest";
import { generateSurvey } from "../survey-generator";
import { generateCorridor } from "../corridor-generator";
import { generateExpandingSquare, generateParallelTrack } from "../sar-generators";
import { MAX_TRANSECTS, PatternLimitError, parseSpacing } from "../types";

// About 1 km x 1 km around a synthetic origin.
const KM_SQUARE: [number, number][] = [
  [12.0, 77.0],
  [12.009, 77.0],
  [12.009, 77.0092],
  [12.0, 77.0092],
];

const surveyBase = {
  polygon: KM_SQUARE,
  gridAngle: 90,
  lineSpacing: 25,
  turnAroundDistance: 0,
  entryLocation: "topLeft" as const,
  flyAlternateTransects: false,
  cameraTriggerDistance: 0,
  altitude: 50,
  speed: 10,
};

describe("pattern generation limits", () => {
  it("survey with 0.01 m spacing over 1 km2 throws quickly", () => {
    const t0 = performance.now();
    expect(() => generateSurvey({ ...surveyBase, lineSpacing: 0.01 })).toThrow(PatternLimitError);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("survey at 0.5 m over 1 km2 exceeds the transect cap", () => {
    expect(() => generateSurvey({ ...surveyBase, lineSpacing: 0.5 })).toThrow(/transects/);
  });

  it("survey at a sane spacing stays under the cap", () => {
    const r = generateSurvey(surveyBase);
    expect(r.stats.transectCount).toBeGreaterThan(0);
    expect(r.stats.transectCount).toBeLessThanOrEqual(MAX_TRANSECTS);
  });

  it("survey rejects a sub-minimum trigger distance", () => {
    expect(() => generateSurvey({ ...surveyBase, cameraTriggerDistance: 0.01 })).toThrow(PatternLimitError);
  });

  it("corridor needing more lines than the limit throws", () => {
    expect(() =>
      generateCorridor({
        pathPoints: [
          [12.0, 77.0],
          [12.5, 77.0],
        ],
        corridorWidth: 5000,
        lineSpacing: 1,
        altitude: 50,
        speed: 10,
      }),
    ).toThrow(PatternLimitError);
  });

  it("SAR generators reject tiny spacing and huge leg counts", () => {
    expect(() =>
      generateExpandingSquare({
        center: [12, 77],
        legSpacing: 0.1,
        maxLegs: 10,
        altitude: 50,
        speed: 10,
        startBearing: 0,
      }),
    ).toThrow(PatternLimitError);
    expect(() =>
      generateParallelTrack({
        startPoint: [12, 77],
        trackLength: 100,
        trackSpacing: 10,
        trackCount: MAX_TRANSECTS + 1,
        bearing: 0,
        altitude: 50,
        speed: 10,
      }),
    ).toThrow(PatternLimitError);
  });

  it("parseSpacing clamps 0.01 to 0.5 and falls back on empty input", () => {
    expect(parseSpacing("0.01", 25)).toBe(0.5);
    expect(parseSpacing("", 25)).toBe(25);
    expect(parseSpacing("12.5", 25)).toBe(12.5);
  });
});
