"use client";

import { useTelemetryStore } from "@/stores/telemetry-store";
import { useClockStore } from "@/stores/clock-store";
import { useClockTick } from "@/lib/agent/freshness";
import { isFresh, type Timestamped } from "@/lib/telemetry/freshness";
import type { RingBuffer } from "@/lib/ring-buffer";

/**
 * Extract only the RingBuffer<T> fields from the telemetry store,
 * excluding actions (_version, push*, clear, etc.).
 */
type TelemetryBufferKey = {
  [K in keyof ReturnType<typeof useTelemetryStore.getState>]: ReturnType<
    typeof useTelemetryStore.getState
  >[K] extends RingBuffer<infer _T>
    ? K
    : never;
}[keyof ReturnType<typeof useTelemetryStore.getState>];

/**
 * Infer the element type T from a RingBuffer<T> field.
 */
type TelemetryBufferElement<K extends TelemetryBufferKey> = ReturnType<
  typeof useTelemetryStore.getState
>[K] extends RingBuffer<infer T>
  ? T
  : never;

/**
 * Returns the latest value from a telemetry ring buffer channel.
 *
 * Equivalent to `useTelemetryStore((s) => s.position.latest())` but shorter.
 * The selector calls `.latest()` inside Zustand's subscription so re-renders
 * are triggered correctly by the store's `_version` counter.
 *
 * @example
 *   const position = useTelemetryLatest("position");
 *   // position: PositionData | undefined
 */
export function useTelemetryLatest<K extends TelemetryBufferKey>(
  field: K,
): TelemetryBufferElement<K> | undefined {
  return useTelemetryStore((s) => telemetryChannels(s)[field].latest());
}

/** The ring buffers, keyed by channel name with each element type restored. */
type TelemetryChannels = {
  [K in TelemetryBufferKey]: RingBuffer<TelemetryBufferElement<K>>;
};

/**
 * Narrow the store state to just its ring buffers. A single structural
 * downcast: the state carries exactly these fields over the channel keys.
 */
function telemetryChannels(state: ReturnType<typeof useTelemetryStore.getState>): TelemetryChannels {
  return state;
}

/**
 * The latest sample of a channel, or `undefined` once it is older than the
 * telemetry freshness threshold.
 *
 * Subscribes to the channel's own latest sample, so a push on another channel
 * does not re-render the caller; the shared 1 Hz clock re-evaluates freshness
 * so a channel that goes silent still drops to `undefined`.
 */
export function useFreshTelemetry<K extends TelemetryBufferKey>(
  field: K,
): TelemetryBufferElement<K> | undefined {
  // Every telemetry element carries `timestamp`; the intersection makes that
  // visible to the freshness gate below.
  const latest = useTelemetryStore(
    (s) =>
      (telemetryChannels(s)[field] as RingBuffer<TelemetryBufferElement<K> & Timestamped>).latest(),
  );
  useClockTick();
  const now = useClockStore((s) => s.now);
  if (latest === undefined) return undefined;
  return isFresh(latest.timestamp, now) ? latest : undefined;
}
