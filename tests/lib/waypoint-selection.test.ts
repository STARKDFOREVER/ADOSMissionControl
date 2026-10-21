import { describe, it, expect } from "vitest";
import { isWaypointSelected } from "@/lib/waypoint-selection";

describe("isWaypointSelected", () => {
  it("counts the single selection", () => {
    expect(isWaypointSelected("a", "a", [])).toBe(true);
  });

  it("counts every member of the multi-selection, not only its anchor", () => {
    expect(isWaypointSelected("c", "a", ["a", "b", "c"])).toBe(true);
  });

  it("leaves other waypoints unselected", () => {
    expect(isWaypointSelected("d", "a", ["a", "b"])).toBe(false);
  });
});
