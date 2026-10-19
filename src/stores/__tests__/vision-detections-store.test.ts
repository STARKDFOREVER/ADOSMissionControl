import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DETECTION_STALE_MS,
  streamKey,
  useVisionDetectionsStore,
  type VisionDetectionBatch,
} from "@/stores/vision-detections-store";

function batch(
  over: Partial<Omit<VisionDetectionBatch, "receivedAt">>,
): Omit<VisionDetectionBatch, "receivedAt"> {
  return {
    modelId: "coco",
    cameraId: "uvc-0",
    frameId: 1,
    tsMs: 0,
    frameWidth: 1280,
    frameHeight: 720,
    detections: [],
    ...over,
  };
}

const DRONE = "node:d1";

describe("vision-detections-store stream keying", () => {
  beforeEach(() => useVisionDetectionsStore.getState().clear());

  it("keeps a per-stream batch per (model, camera) without clobbering", () => {
    const s = useVisionDetectionsStore.getState();
    s.setBatch(DRONE, batch({ modelId: "person", cameraId: "uvc-0" }));
    s.setBatch(DRONE, batch({ modelId: "depth", cameraId: "uvc-0" }));
    // Two models -> two distinct streams (the second no longer overwrites the
    // first, the bug the re-key fixes).
    const streams = useVisionDetectionsStore.getState().streamsForDrone(DRONE);
    expect(streams).toHaveLength(2);
    const models = streams.map((b) => b.modelId).sort();
    expect(models).toEqual(["depth", "person"]);
  });

  it("splits streams by camera too", () => {
    const s = useVisionDetectionsStore.getState();
    s.setBatch(DRONE, batch({ modelId: "person", cameraId: "uvc-0" }));
    s.setBatch(DRONE, batch({ modelId: "person", cameraId: "uvc-1" }));
    expect(useVisionDetectionsStore.getState().streamsForDrone(DRONE)).toHaveLength(2);
  });

  it("a re-published stream replaces only its own key", () => {
    const s = useVisionDetectionsStore.getState();
    s.setBatch(DRONE, batch({ modelId: "person", frameId: 1 }));
    s.setBatch(DRONE, batch({ modelId: "person", frameId: 2 }));
    const streams = useVisionDetectionsStore.getState().streamsForDrone(DRONE);
    expect(streams).toHaveLength(1);
    expect(streams[0].frameId).toBe(2);
  });

  it("still exposes the latest-across-streams batch for the cockpit", () => {
    const s = useVisionDetectionsStore.getState();
    s.setBatch(DRONE, batch({ modelId: "person" }));
    s.setBatch(DRONE, batch({ modelId: "depth" }));
    // The simple per-drone `batches` view is the most-recent batch.
    expect(useVisionDetectionsStore.getState().batches[DRONE].modelId).toBe("depth");
  });

  it("clearBatch drops both the latest and the streams", () => {
    const s = useVisionDetectionsStore.getState();
    s.setBatch(DRONE, batch({ modelId: "person" }));
    s.clearBatch(DRONE);
    const st = useVisionDetectionsStore.getState();
    expect(st.batches[DRONE]).toBeUndefined();
    expect(st.streamsForDrone(DRONE)).toEqual([]);
  });

  it("streamKey is model::camera", () => {
    expect(streamKey("person", "uvc-0")).toBe("person::uvc-0");
  });
});

describe("vision-detections-store ordering and age", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    useVisionDetectionsStore.getState().clear();
  });
  afterEach(() => vi.useRealTimers());

  it("drops a late batch taken before the one its stream is showing", () => {
    const s = useVisionDetectionsStore.getState();
    s.setBatch(DRONE, batch({ frameId: 5, tsMs: 9_990 }));
    vi.setSystemTime(10_050);
    s.setBatch(DRONE, batch({ frameId: 4, tsMs: 9_950 }));
    const st = useVisionDetectionsStore.getState();
    expect(st.batches[DRONE].frameId).toBe(5);
    expect(st.streamsForDrone(DRONE)[0].frameId).toBe(5);
  });

  it("ages a backlogged batch by when it was taken, not when it arrived", () => {
    const s = useVisionDetectionsStore.getState();
    // Live: taken 10 ms before it arrived.
    s.setBatch(DRONE, batch({ frameId: 1, tsMs: 9_990 }));
    // The link stalls; a frame taken at 10 500 is delivered at 15 000.
    vi.setSystemTime(15_000);
    s.setBatch(DRONE, batch({ frameId: 2, tsMs: 10_500 }));
    const late = useVisionDetectionsStore.getState().batches[DRONE];
    expect(late.frameId).toBe(2);
    expect(Date.now() - late.receivedAt).toBeGreaterThan(DETECTION_STALE_MS);
  });

  it("reads a batch arriving with the stream's usual latency as just received", () => {
    const s = useVisionDetectionsStore.getState();
    s.setBatch(DRONE, batch({ frameId: 1, tsMs: 9_990 }));
    vi.setSystemTime(10_100);
    s.setBatch(DRONE, batch({ frameId: 2, tsMs: 10_090 }));
    expect(useVisionDetectionsStore.getState().batches[DRONE].receivedAt).toBe(10_100);
  });

  it("ages by arrival on the GCS clock when tsMs is the agent's monotonic time", () => {
    vi.setSystemTime(1_760_000_000_000);
    const s = useVisionDetectionsStore.getState();
    // tsMs is ms since the agent booted: nowhere near wall time.
    s.setBatch(DRONE, batch({ frameId: 1, tsMs: 120_000 }));
    vi.setSystemTime(1_760_000_000_050);
    s.setBatch(DRONE, batch({ frameId: 2, tsMs: 120_050 }));
    expect(useVisionDetectionsStore.getState().batches[DRONE].receivedAt).toBe(1_760_000_000_050);
  });

  it("follows an agent restart instead of dropping its frames as old or stale", () => {
    vi.setSystemTime(1_760_000_000_000);
    const s = useVisionDetectionsStore.getState();
    s.setBatch(DRONE, batch({ frameId: 900, tsMs: 3_600_000 }));
    // The agent restarts: its monotonic clock begins again near zero.
    vi.setSystemTime(1_760_000_000_100);
    s.setBatch(DRONE, batch({ frameId: 1, tsMs: 2_000 }));
    const st = useVisionDetectionsStore.getState().batches[DRONE];
    expect(st.frameId).toBe(1);
    expect(st.receivedAt).toBe(1_760_000_000_100);
  });
});

describe("vision-detections-store engine availability", () => {
  beforeEach(() => useVisionDetectionsStore.getState().clear());

  it("flags a drone not running and drops its feed when the agent reports unavailable", () => {
    const s = useVisionDetectionsStore.getState();
    s.setBatch(DRONE, batch({ tsMs: Date.now() }));
    s.setVisionAvailable(DRONE, false);
    const state = useVisionDetectionsStore.getState();
    expect(state.visionUnavailable[DRONE]).toBe(true);
    expect(state.batches[DRONE]).toBeUndefined();
    expect(state.streamsForDrone(DRONE)).toEqual([]);
    expect(state.receiptTimes(DRONE)).toEqual([]);
  });

  it("treats a repeated unavailable report as a no-op", () => {
    const s = useVisionDetectionsStore.getState();
    s.setVisionAvailable(DRONE, false);
    const before = useVisionDetectionsStore.getState();
    s.setVisionAvailable(DRONE, false);
    expect(useVisionDetectionsStore.getState()).toBe(before);
  });

  it("clears the flag when detections resume", () => {
    const s = useVisionDetectionsStore.getState();
    s.setVisionAvailable(DRONE, false);
    s.setBatch(DRONE, batch({ tsMs: Date.now() }));
    const state = useVisionDetectionsStore.getState();
    expect(DRONE in state.visionUnavailable).toBe(false);
    expect(state.batches[DRONE]).toBeDefined();
  });

  it("clears the flag on an available report and on clearBatch", () => {
    const s = useVisionDetectionsStore.getState();
    s.setVisionAvailable(DRONE, false);
    s.setVisionAvailable(DRONE, true);
    expect(DRONE in useVisionDetectionsStore.getState().visionUnavailable).toBe(false);
    s.setVisionAvailable(DRONE, false);
    s.clearBatch(DRONE);
    expect(DRONE in useVisionDetectionsStore.getState().visionUnavailable).toBe(false);
  });

  it("keeps the flag per drone", () => {
    const s = useVisionDetectionsStore.getState();
    s.setVisionAvailable(DRONE, false);
    s.setBatch("node:d2", batch({ tsMs: Date.now() }));
    expect(useVisionDetectionsStore.getState().visionUnavailable[DRONE]).toBe(true);
  });
});
