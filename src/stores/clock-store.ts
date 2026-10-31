/**
 * @module ClockStore
 * @description Shared 1Hz ticker used by freshness / "Xs ago" UI. One
 * module-level interval + one Zustand store means every consumer (header,
 * sidebar, cards, sparklines) re-renders in lockstep instead of each spawning
 * its own interval. The interval is lazy: it starts on the first subscription
 * and stops when the last subscriber unmounts. `now` is refreshed when the
 * clock starts, so the first reader never sees the time the module was
 * imported or last ticked.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { create } from "zustand";
import { isFresh } from "@/lib/telemetry/freshness";

interface ClockState {
  /** Monotonic counter, bumped once per second. */
  tick: number;
  /** Wall-clock millis captured at the moment the last tick fired. */
  now: number;
}

export const useClockStore = create<ClockState>(() => ({
  tick: 0,
  now: Date.now(),
}));

let intervalId: ReturnType<typeof setInterval> | null = null;
let subscriberCount = 0;

function startInterval() {
  if (intervalId != null) return;
  intervalId = setInterval(() => {
    useClockStore.setState((s) => ({ tick: s.tick + 1, now: Date.now() }));
  }, 1000);
}

function stopInterval() {
  if (intervalId == null) return;
  clearInterval(intervalId);
  intervalId = null;
}

/**
 * Subscribe/unsubscribe helper. Components that want to re-render at 1Hz
 * should call this in an effect so the shared interval refcounts correctly.
 * Returns an unsubscribe function.
 */
export function subscribeToClock(): () => void {
  subscriberCount += 1;
  if (subscriberCount === 1) {
    useClockStore.setState((s) => ({ tick: s.tick, now: Date.now() }));
    startInterval();
  }
  return () => {
    subscriberCount -= 1;
    if (subscriberCount === 0) stopInterval();
  };
}

/**
 * Whether `at` is a live telemetry timestamp on the shared clock.
 *
 * The verdict is computed inside the selector, so the caller re-renders only
 * when it flips, not on every tick. `null`/`undefined` (never received) is
 * never fresh.
 */
export function useIsFresh(at: number | null | undefined): boolean {
  useEffect(() => subscribeToClock(), []);
  return useClockStore((s) => at != null && isFresh(at, s.now));
}
