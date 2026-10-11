/**
 * @module mock-detections-vision-off.test
 * @description The demo detection stream models one drone whose vision
 * engine is not running: it records the agent's `available:false` report
 * instead of pushing batches, and stopping the stream clears it.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockDetectionStream, VISION_OFF_DEMO_DRONE } from "@/mock/mock-detections";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

describe("mockDetectionStream vision-off drone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useVisionDetectionsStore.getState().clear();
  });
  afterEach(() => {
    mockDetectionStream.stop();
    vi.useRealTimers();
  });

  it("flags the vision-off demo drone and pushes no batches", () => {
    const id = nodeIdForDevice(VISION_OFF_DEMO_DRONE);
    mockDetectionStream.start(id);
    vi.advanceTimersByTime(500);
    const state = useVisionDetectionsStore.getState();
    expect(state.visionUnavailable[id]).toBe(true);
    expect(state.batches[id]).toBeUndefined();
    mockDetectionStream.stop();
    expect(id in useVisionDetectionsStore.getState().visionUnavailable).toBe(false);
  });

  it("streams batches for any other demo drone", () => {
    const id = nodeIdForDevice("alpha-1");
    mockDetectionStream.start(id);
    vi.advanceTimersByTime(250);
    const state = useVisionDetectionsStore.getState();
    expect(state.batches[id]).toBeDefined();
    expect(id in state.visionUnavailable).toBe(false);
  });
});
