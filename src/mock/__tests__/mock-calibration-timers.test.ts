/**
 * @module mock/mock-calibration-timers.test
 * @description Calibration timers stop when the demo link disconnects.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProtocol } from "@/mock/mock-protocol";

describe("mock calibration timers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits no status text after disconnect during a PX4 gyro calibration", async () => {
    const p = new MockProtocol("px4");
    const texts: string[] = [];
    p.onStatusText((m) => texts.push(m.text));

    await p.startCalibration("gyro");
    vi.advanceTimersByTime(450);
    expect(texts.length).toBeGreaterThan(0);

    await p.disconnect();
    const seen = texts.length;
    vi.advanceTimersByTime(5000);
    expect(texts.length).toBe(seen);
  });

  it("emits no status text after disconnect during an ArduPilot ESC calibration", async () => {
    const p = new MockProtocol("ardupilot-copter");
    const texts: string[] = [];
    p.onStatusText((m) => texts.push(m.text));

    await p.startCalibration("esc");
    await p.disconnect();
    const seen = texts.length;
    vi.advanceTimersByTime(5000);
    expect(texts.length).toBe(seen);
  });
});
