import { describe, it, expect } from "vitest";
import { demoStartPlan } from "@/components/layout/DemoMissionSync";
import { DEMO_PLANS } from "@/mock/demo-missions";

describe("demoStartPlan", () => {
  it("keeps the plan that was open before a reload", () => {
    const open = DEMO_PLANS[2];
    expect(demoStartPlan(open.id, DEMO_PLANS)).toBe(open);
  });

  it("opens the first demo mission when no plan was open", () => {
    expect(demoStartPlan(null, DEMO_PLANS)).toBe(DEMO_PLANS[0]);
  });

  it("opens the first demo mission when the open plan no longer exists", () => {
    expect(demoStartPlan("deleted-plan", DEMO_PLANS)).toBe(DEMO_PLANS[0]);
  });
});
