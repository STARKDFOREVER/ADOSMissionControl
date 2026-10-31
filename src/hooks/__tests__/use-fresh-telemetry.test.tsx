/**
 * `useFreshTelemetry` subscribes to its own channel: a store update that only
 * carries another channel's sample must not re-render the caller.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { useTelemetryStore } from "@/stores/telemetry-store";
import type { AttitudeData, BatteryData } from "@/lib/types";

/** One entry per render of the reader: the value the hook returned. */
const seen: (BatteryData | undefined)[] = [];

function BatteryReader() {
  seen.push(useFreshTelemetry("battery"));
  return null;
}

/** Push a sample the way the store's push actions do, flushing the bump now. */
function pushAndBump(push: () => void) {
  act(() => {
    push();
    useTelemetryStore.setState((s) => ({ _version: s._version + 1 }));
  });
}

function attitude(): AttitudeData {
  return { timestamp: Date.now(), roll: 1, pitch: 2, yaw: 3, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0 };
}

function battery(voltage: number): BatteryData {
  return { timestamp: Date.now(), voltage, current: 10, remaining: 80, consumed: 100 };
}

beforeEach(() => {
  useTelemetryStore.getState().clear();
  seen.length = 0;
});

afterEach(cleanup);

describe("useFreshTelemetry", () => {
  it("does not re-render when only another channel is pushed", () => {
    render(<BatteryReader />);
    pushAndBump(() => useTelemetryStore.getState().battery.push(battery(16.2)));
    expect(seen.at(-1)?.voltage).toBe(16.2);
    const before = seen.length;

    for (let i = 0; i < 20; i++) {
      pushAndBump(() => useTelemetryStore.getState().attitude.push(attitude()));
    }

    expect(seen.length).toBe(before);
  });

  it("re-renders with the new sample when its own channel is pushed", () => {
    render(<BatteryReader />);
    pushAndBump(() => useTelemetryStore.getState().battery.push(battery(15.0)));
    const before = seen.length;

    pushAndBump(() => useTelemetryStore.getState().battery.push(battery(14.8)));

    expect(seen.length).toBeGreaterThan(before);
    expect(seen.at(-1)?.voltage).toBe(14.8);
  });
});
