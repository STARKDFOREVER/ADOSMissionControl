import { describe, it, expect } from "vitest";
import { altitudeFromDrag, metersPerPixel } from "@/components/planner/three/drag-math";

describe("planner 3D drag math", () => {
  it("metersPerPixel spans the frustum height over the canvas height", () => {
    expect(metersPerPixel(1000, Math.PI / 3, 800)).toBeCloseTo(1.443, 3);
  });

  it("dragging down lowers a relative altitude to the ground", () => {
    expect(altitudeFromDrag(50, 100, 0.5, "relative")).toBe(0);
  });

  it("clamps relative altitudes at the ground", () => {
    expect(altitudeFromDrag(50, 120, 0.5, "relative")).toBe(0);
  });

  it("dragging up raises the altitude", () => {
    expect(altitudeFromDrag(50, -40, 0.5, "relative")).toBe(70);
  });

  it("lets absolute altitudes go below zero", () => {
    expect(altitudeFromDrag(50, 120, 0.5, "absolute")).toBe(-10);
  });

  it("clamps terrain-following altitudes at the ground", () => {
    expect(altitudeFromDrag(10, 100, 0.5, "terrain")).toBe(0);
  });

  it("rounds to 0.1 m", () => {
    expect(altitudeFromDrag(50, -1, 0.123, "relative")).toBe(50.1);
  });
});
