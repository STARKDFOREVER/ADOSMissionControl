/**
 * @license GPL-3.0-only
 *
 * The node flags `gnss` / `lora` / `sim` a cloud heartbeat carries reach the
 * capability store the same way the LAN `/api/status/full` poll delivers them,
 * so a ground station reached only through the cloud relay shows its GNSS and
 * LoRa tabs.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      get length() {
        return mem.size;
      },
    },
  });
});

import { applyCloudCapabilities } from "@/components/command/use-cloud-inventory-fanout";
import { mapCloudStatus } from "@/components/command/bridges/status-mapper";
import { buildHeartbeatExtras } from "@/components/command/bridges/status-mapper/heartbeat-extras";
import {
  selectDeviceCapabilities,
  useAgentCapabilitiesStore,
} from "@/stores/agent-capabilities-store";

const DEVICE = "gs-cloud-1";

function tick(record: Record<string, unknown>) {
  const row = {
    deviceId: DEVICE,
    version: "0.104.0",
    profile: "ground-station",
    boardName: "rock-5c",
    boardSoc: "RK3588S",
    updatedAt: 1_760_000_000_000,
    ...record,
  };
  applyCloudCapabilities(mapCloudStatus(row), row, DEVICE, []);
  return selectDeviceCapabilities(useAgentCapabilitiesStore.getState(), DEVICE);
}

describe("cloud heartbeat node flags", () => {
  beforeEach(() => {
    useAgentCapabilitiesStore.getState().clear();
  });

  it("carries only boolean flags", () => {
    expect(buildHeartbeatExtras({ gnss: true, lora: "yes", sim: false }).nodeFlags).toEqual({
      gnss: true,
      sim: false,
    });
    expect(buildHeartbeatExtras({}).nodeFlags).toEqual({});
  });

  it("reaches the store on the first heartbeat and on the re-merge", () => {
    const first = tick({ gnss: true, lora: true, sim: false });
    expect(first?.loaded).toBe(true);
    expect(first?.gnss).toBe(true);
    expect(first?.lora).toBe(true);
    expect(first?.sim).toBe(false);

    const second = tick({ gnss: false, lora: true, sim: true });
    expect(second?.gnss).toBe(false);
    expect(second?.sim).toBe(true);
  });

  it("keeps the prior flag when an older agent omits it", () => {
    tick({ gnss: true, lora: true });
    const sparse = tick({});
    expect(sparse?.gnss).toBe(true);
    expect(sparse?.lora).toBe(true);
  });
});
