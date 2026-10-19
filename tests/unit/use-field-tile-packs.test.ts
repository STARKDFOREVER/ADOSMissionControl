/**
 * The field-pack poll keeps the last reachable pack through a single failed
 * read and drops it only after three failures in a row.
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { FieldTileSource } from "@/stores/field-pack-store";
import type { LocalNode } from "@/stores/local-nodes-store";

const findFieldTileSource = vi.fn<(ids: string[], signal: AbortSignal) => Promise<FieldTileSource | null>>();
vi.mock("@/lib/agent/field-tile-packs", () => ({
  findFieldTileSource: (ids: string[], signal: AbortSignal) => findFieldTileSource(ids, signal),
}));

import { useFieldTilePacks } from "@/hooks/use-field-tile-packs";
import { useFieldPackStore } from "@/stores/field-pack-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

const SOURCE: FieldTileSource = { baseUrl: "http://ground.local:8080", apiKey: "k", packs: [] };

const GROUND: LocalNode = {
  deviceId: "gs1",
  name: "Ground",
  hostname: "http://ground.local:8080",
  apiKey: "k",
  profile: "ground-station",
  pairedAt: 0,
};

describe("useFieldTilePacks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    findFieldTileSource.mockReset();
    useFieldPackStore.setState({ source: null });
    useLocalNodesStore.setState({ nodes: [GROUND] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets the source, keeps it through one failure and drops it after three", async () => {
    findFieldTileSource.mockResolvedValueOnce(SOURCE);
    const { result, unmount } = renderHook(() => useFieldTilePacks());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual(SOURCE);

    findFieldTileSource.mockResolvedValue(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current).toEqual(SOURCE);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current).toEqual(SOURCE);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current).toBeNull();
    unmount();
  });

  it("resets the failure count after a successful read", async () => {
    findFieldTileSource
      .mockResolvedValueOnce(SOURCE)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(SOURCE)
      .mockResolvedValueOnce(null);
    const { result, unmount } = renderHook(() => useFieldTilePacks());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
    });
    expect(result.current).toEqual(SOURCE);
    unmount();
  });
});
