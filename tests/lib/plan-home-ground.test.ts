import { describe, it, expect } from "vitest";
import { planHomeGroundElevation } from "@/lib/mission/altitude-frame";

const launch = { lat: 46, lon: 7.6, alt: 30, groundElevation: 3600 };

describe("planHomeGroundElevation", () => {
  it("uses the planned home's ground when the plan has one", () => {
    expect(planHomeGroundElevation(4039, [launch])).toBe(4039);
  });

  it("falls back to the launch waypoint's sample without a planned home", () => {
    expect(planHomeGroundElevation(undefined, [launch])).toBe(3600);
  });

  it("is unknown when neither is known", () => {
    expect(planHomeGroundElevation(undefined, [{ ...launch, groundElevation: undefined }])).toBeUndefined();
  });
});
