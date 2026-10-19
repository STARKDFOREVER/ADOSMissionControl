/**
 * @license GPL-3.0-only
 *
 * `gnssBaseBody` builds exactly the three `PUT /api/v1/gnss/base` payloads the
 * agent accepts and refuses incomplete or out-of-range drafts.
 */

import { describe, it, expect } from "vitest";
import { gnssBaseBody } from "../gnss";

describe("gnssBaseBody", () => {
  it("builds the off body with no other keys", () => {
    expect(gnssBaseBody({ mode: "off", minDurS: 300, latDeg: 1 })).toEqual({ mode: "off" });
  });

  it("builds the survey body with duration and accuracy only", () => {
    expect(gnssBaseBody({ mode: "survey", minDurS: 300, accuracyM: 2.0, latDeg: 12 })).toEqual({
      mode: "survey",
      min_dur_s: 300,
      accuracy_m: 2.0,
    });
  });

  it("builds the fixed body with the position only", () => {
    expect(
      gnssBaseBody({ mode: "fixed", latDeg: 12.9716, lonDeg: 77.5946, hEllipsoidM: 920.4, minDurS: 300 }),
    ).toEqual({ mode: "fixed", lat_deg: 12.9716, lon_deg: 77.5946, h_ellipsoid_m: 920.4 });
  });

  it("refuses incomplete or out-of-range drafts", () => {
    expect(gnssBaseBody({ mode: "survey", minDurS: 0, accuracyM: 2 })).toBeNull();
    expect(gnssBaseBody({ mode: "survey", minDurS: 300 })).toBeNull();
    expect(gnssBaseBody({ mode: "fixed", latDeg: 91, lonDeg: 0, hEllipsoidM: 0 })).toBeNull();
    expect(gnssBaseBody({ mode: "fixed", latDeg: 10, lonDeg: 181, hEllipsoidM: 0 })).toBeNull();
    expect(gnssBaseBody({ mode: "fixed", latDeg: 10, lonDeg: 10, hEllipsoidM: NaN })).toBeNull();
  });
});
