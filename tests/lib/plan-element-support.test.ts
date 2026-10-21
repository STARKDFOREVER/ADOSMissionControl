import { describe, it, expect } from "vitest";
import { planElementSupport } from "@/app/plan/plan-element-support";

describe("planElementSupport", () => {
  it("offers fence and rally with no vehicle selected, whatever is connected", () => {
    expect(planElementSupport(false, () => false)).toEqual({ showGeofence: true, showRally: true });
  });

  it("follows the selected vehicle's capabilities", () => {
    const fenceOnly = (cap: string) => cap === "supportsGeoFence";
    expect(planElementSupport(true, fenceOnly)).toEqual({ showGeofence: true, showRally: false });
  });
});
