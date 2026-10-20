/**
 * Clock store: the first subscriber gets the current time, not the time the
 * module was imported or last ticked.
 * @license GPL-3.0-only
 */
import { describe, it, expect } from "vitest";
import { useClockStore, subscribeToClock } from "@/stores/clock-store";

describe("clock store", () => {
  it("refreshes now when the first consumer subscribes", () => {
    useClockStore.setState({ now: Date.now() - 10_000 });
    const off = subscribeToClock();
    try {
      expect(Math.abs(useClockStore.getState().now - Date.now())).toBeLessThan(50);
    } finally {
      off();
    }
  });
});
