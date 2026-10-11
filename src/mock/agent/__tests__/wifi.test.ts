/**
 * @module mock/agent/__tests__/wifi.test
 * @description The demo Wi-Fi client: in a demo session the `mock://demo`
 * agent answers the `/api/v1/network/client/*` routes in memory, through the
 * real `network-client` parsing, so the node's Wi-Fi page reads a connection,
 * a scan list and saved networks instead of a fetch failure; joins, leaves,
 * forgets and autoconnect toggles change what the next read returns.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  agentNetworkContext,
  forgetWifi,
  getConfiguredWifi,
  getWifiStatus,
  joinWifi,
  leaveWifi,
  scanWifi,
  setWifiAutoconnect,
} from "@/lib/agent/network-client";
import { mockWifiRoute, resetMockWifi } from "@/mock/agent/wifi";
import { useSettingsStore } from "@/stores/settings-store";

const CTX = agentNetworkContext("mock://demo", null)!;
const LOCALLY_ADMINISTERED = /^02:00:00(:[0-9a-f]{2}){3}$/;

describe("demo Wi-Fi client", () => {
  beforeEach(() => {
    resetMockWifi();
    useSettingsStore.setState({ demoMode: true, _hasHydrated: true });
  });
  afterEach(() => {
    useSettingsStore.setState({ demoMode: false });
    vi.unstubAllGlobals();
  });

  it("answers in memory without touching the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const status = await getWifiStatus(CTX);
    expect(status).toEqual({
      connected: true,
      ssid: "Field-Ops-5G",
      bssid: "02:00:00:5e:10:01",
      signal: 82,
      ip: "192.168.7.1",
      gateway: null,
      security: "WPA2",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("scans synthetic networks strongest first, marking the one in use", async () => {
    const networks = await scanWifi(CTX);
    expect(networks.map((n) => n.ssid)).toEqual([
      "Field-Ops-5G",
      "Hangar-2G",
      "Survey-Van",
      "Bench-Open",
    ]);
    const signals = networks.map((n) => n.signal);
    expect(signals).toEqual([...signals].sort((a, b) => b - a));
    expect(networks.filter((n) => n.in_use).map((n) => n.ssid)).toEqual(["Field-Ops-5G"]);
    for (const n of networks) expect(n.bssid).toMatch(LOCALLY_ADMINISTERED);
    expect(networks.find((n) => n.ssid === "Bench-Open")?.security).toBe("");
  });

  it("lists the saved profiles", async () => {
    expect(await getConfiguredWifi(CTX)).toEqual([
      { name: "Field-Ops-5G", type: "802-11-wireless", device: "wlan0", autoconnect: true },
      { name: "Hangar-2G", type: "802-11-wireless", device: null, autoconnect: false },
    ]);
  });

  it("refuses a secured join without a passphrase and joins with one", async () => {
    const refused = await joinWifi(CTX, { ssid: "Survey-Van" });
    expect(refused.joined).toBe(false);
    expect(refused.error).toMatch(/Secrets were required/);

    const joined = await joinWifi(CTX, { ssid: "Survey-Van", passphrase: "demo-pass" });
    expect(joined).toEqual({ joined: true, ip: "192.168.7.1", gateway: null, error: null });
    expect((await getWifiStatus(CTX)).ssid).toBe("Survey-Van");
    const saved = await getConfiguredWifi(CTX);
    expect(saved.find((p) => p.name === "Survey-Van")?.device).toBe("wlan0");
    expect(saved.find((p) => p.name === "Field-Ops-5G")?.device).toBeNull();
  });

  it("joins a saved network without re-sending the passphrase", async () => {
    expect((await joinWifi(CTX, { ssid: "Hangar-2G" })).joined).toBe(true);
    expect((await scanWifi(CTX)).find((n) => n.in_use)?.ssid).toBe("Hangar-2G");
  });

  it("disconnects and then reports no connection", async () => {
    expect(await leaveWifi(CTX)).toEqual({ left: true, previous_ssid: "Field-Ops-5G" });
    expect(await getWifiStatus(CTX)).toMatchObject({ connected: false, ssid: null });
    expect((await scanWifi(CTX)).some((n) => n.in_use)).toBe(false);
  });

  it("toggles autoconnect and forgets a profile", async () => {
    await setWifiAutoconnect(CTX, "Hangar-2G", true);
    expect((await getConfiguredWifi(CTX)).find((p) => p.name === "Hangar-2G")?.autoconnect).toBe(
      true,
    );
    await forgetWifi(CTX, "Hangar-2G");
    expect((await getConfiguredWifi(CTX)).map((p) => p.name)).toEqual(["Field-Ops-5G"]);
    await expect(forgetWifi(CTX, "Hangar-2G")).rejects.toMatchObject({ status: 404 });
  });

  it("answers an unknown route with 404", () => {
    expect(mockWifiRoute("GET", "/api/v1/network/client/nope").status).toBe(404);
  });
});
