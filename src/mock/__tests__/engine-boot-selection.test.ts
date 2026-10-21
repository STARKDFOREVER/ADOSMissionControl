/**
 * @module mock/engine-boot-selection.test
 * @description The demo boots with no drone selected, so selecting one stays
 * an operator action and a page load never swaps the open plan for a drone's
 * onboard mission.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockEngine } from "@/mock/engine";
import { useDroneManager } from "@/stores/drone-manager";

describe("demo engine boot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  });
  afterEach(() => {
    mockEngine.stop();
    vi.useRealTimers();
  });

  it("adds the demo drones without selecting one", () => {
    mockEngine.start(50);
    expect(useDroneManager.getState().drones.size).toBeGreaterThan(0);
    expect(useDroneManager.getState().selectedDroneId).toBeNull();
  });
});
