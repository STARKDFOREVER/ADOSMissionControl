/**
 * @license GPL-3.0-only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LORA_REGIONS_RETRY_MS, useLoraStore } from "@/stores/ground-station/lora-store";
import { DEMO_LORA } from "@/mock/demo-seed/ground-station-lanes";
import type { GroundStationApi } from "@/lib/api/ground-station-api";

/** Let the poll's fire-and-forget region read settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("lora-store region table backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    useLoraStore.setState({ status: null, regions: null, loraFor: null, error: null, fetchedAt: null });
  });
  afterEach(() => vi.useRealTimers());

  it("asks for the table again only after the retry window once a read failed", async () => {
    const getLoraRegions = vi.fn(async () => {
      throw new Error("route missing");
    });
    const api = {
      baseUrl: "http://192.168.1.50:8080",
      getLora: async () => DEMO_LORA,
      getLoraRegions,
    } as unknown as GroundStationApi;
    const { load } = useLoraStore.getState();

    await load(api);
    await settle();
    expect(getLoraRegions).toHaveBeenCalledTimes(1);

    // Every status poll inside the window leaves the failed table alone.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(1_000);
      await load(api);
      await settle();
    }
    expect(getLoraRegions).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(LORA_REGIONS_RETRY_MS);
    await load(api);
    await settle();
    expect(getLoraRegions).toHaveBeenCalledTimes(2);
  });
});
