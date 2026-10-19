/**
 * @license GPL-3.0-only
 *
 * Multi-adapter radio view: the diversity summary math (agent verdict wins,
 * otherwise derived from the receive adapters) and one card per adapter.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act, renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../locales/en.json";
import {
  adapterLossPct,
  diversitySummary,
  normalizeRadioAdapters,
} from "@/lib/api/ground-station/radio-adapters";
import { RadioAdaptersView } from "../RadioAdaptersView";
import { useRadioAdapters } from "../use-radio-adapters";
import {
  RSSI_HISTORY_CAPACITY,
  useAdapterRssiHistoryStore,
} from "@/stores/ground-station/adapter-rssi-history-store";

afterEach(cleanup);

const WIRE = [
  { iface: "wlan1", mac: "02:00:00:00:01:01", usb_path: "1-1.2", driver: "rtl88x2eu", role: "rxtx", antenna: "omni-5.8", tx_active: true, rssi_dbm: [-48, -51], packets: 990, lost: 10, fec_rec: 540, verified: true },
  { iface: "wlan2", role: "rx", antenna: "lhcp-patch", rssi_dbm: [-55], packets: 980, lost: 20, fec_rec: 612, verified: true },
  { iface: "wlan3", role: "rx", rssi_dbm: [], packets: 970, lost: 30, fec_rec: 700, verified: false },
  { iface: "wlan4", role: "mesh", packets: 500, lost: 0 },
  { role: "rx" },
];

describe("normalizeRadioAdapters", () => {
  it("keeps wire fields, drops entries without an iface and nulls unknown roles", () => {
    const out = normalizeRadioAdapters([...WIRE, { iface: "wlan9", role: "laser" }]);
    expect(out.map((a) => a.iface)).toEqual(["wlan1", "wlan2", "wlan3", "wlan4", "wlan9"]);
    expect(out[0].rssi_dbm).toEqual([-48, -51]);
    expect(out[1].mac).toBeNull();
    expect(out[4].role).toBeNull();
    expect(normalizeRadioAdapters(undefined)).toEqual([]);
  });
});

describe("diversitySummary", () => {
  const adapters = normalizeRadioAdapters(WIRE);

  it("derives receive adapters and the best single loss from rx/rxtx adapters", () => {
    expect(adapterLossPct(adapters[0])).toBeCloseTo(1.0);
    const s = diversitySummary(adapters, null, 0.25);
    expect(s.rxAdapters).toBe(3);
    expect(s.bestSingleLossPct).toBeCloseTo(1.0);
    expect(s.combinedLossPct).toBe(0.25);
    expect(s.gainRatio).toBeCloseTo(4.0);
  });

  it("prefers the agent's own diversity verdict", () => {
    const s = diversitySummary(adapters, { rx_adapters: 3, combined_loss_pct: 0.1, best_single_loss_pct: 1.2 }, 0.5);
    expect(s.combinedLossPct).toBe(0.1);
    expect(s.bestSingleLossPct).toBe(1.2);
    expect(s.gainRatio).toBeCloseTo(12);
  });

  it("reports no gain when combined loss is zero or unknown", () => {
    expect(diversitySummary(adapters, null, 0).gainRatio).toBeNull();
    expect(diversitySummary(adapters, null, null).gainRatio).toBeNull();
    expect(diversitySummary([], null, 1).bestSingleLossPct).toBeNull();
  });
});

describe("RadioAdaptersView", () => {
  it("renders one card per adapter and the diversity summary", () => {
    const adapters = normalizeRadioAdapters(WIRE.slice(0, 3));
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RadioAdaptersView adapters={adapters} summary={diversitySummary(adapters, null, 0.25)} historyKey="gs-a" />
      </NextIntlClientProvider>,
    );
    for (const iface of ["wlan1", "wlan2", "wlan3"]) {
      expect(screen.getByRole("group", { name: iface })).toBeTruthy();
    }
    const wlan1 = screen.getByRole("group", { name: "wlan1" });
    expect(wlan1.textContent).toContain("RX+TX");
    expect(wlan1.textContent).toContain("omni-5.8");
    expect(wlan1.textContent).toContain("-51 dBm");
    expect(screen.getByRole("group", { name: "wlan3" }).textContent).toContain("Unverified");
    expect(screen.getByText("Gain ×4.0 over the best single adapter")).toBeTruthy();
  });

  it("keeps a bounded per-chain RSSI history per iface and draws it", () => {
    const view = (adapters: ReturnType<typeof normalizeRadioAdapters>) => (
      <NextIntlClientProvider locale="en" messages={messages}>
        <RadioAdaptersView adapters={adapters} summary={diversitySummary(adapters)} historyKey="gs-b" />
      </NextIntlClientProvider>
    );
    const first = normalizeRadioAdapters(WIRE.slice(0, 2));
    const { rerender } = render(view(first));
    // Re-rendering the same reading never double-counts it.
    rerender(view(first));
    for (let i = 0; i < RSSI_HISTORY_CAPACITY + 10; i += 1) {
      act(() => {
        rerender(view(normalizeRadioAdapters(WIRE.slice(0, 2))));
      });
    }
    const hist = useAdapterRssiHistoryStore.getState().byNode["gs-b"];
    expect(hist.wlan1).toHaveLength(2);
    expect(hist.wlan2).toHaveLength(1);
    expect(hist.wlan1[0].length).toBe(RSSI_HISTORY_CAPACITY);
    const spark = screen.getByRole("img", { name: "wlan1 RSSI A history" });
    expect(spark.querySelector("polyline")).not.toBeNull();
  });
});

describe("useRadioAdapters", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stops polling an agent that answers 404 until the agent changes", async () => {
    const fetchMock = vi.fn(async () => new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender, unmount } = renderHook(({ url }) => useRadioAdapters(url, "k"), {
      initialProps: { url: "http://192.168.1.50:8080" },
    });
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ url: "http://192.168.1.51:8080" });
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
  });
});
