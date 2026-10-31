/**
 * @license GPL-3.0-only
 *
 * The node flags `gnss` / `lora` (and `sim`) that `/api/status/full` carries at
 * the top level reach the capability store over the LAN poll, so the ground
 * station's GNSS and LoRa tabs appear on a real paired agent and not only in
 * demo. The pick list in `applyFullStatus` is explicit, so a flag left out of
 * it never reached the store.
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

import { applyFullStatus } from "@/stores/agent-connection/apply-full-status";
import {
  capabilityPresence,
  selectDeviceCapabilities,
  useAgentCapabilitiesStore,
} from "@/stores/agent-capabilities-store";
import type { LanStatusFull } from "@/lib/agent/types";

// Top-level fields of a `/api/status/full` body captured from agent 0.104.0 on
// the simulation bench VM (visor profile, no GNSS receiver or LoRa radio).
const CAPTURED = {
  version: "0.104.0",
  uptime_seconds: 352.703688487,
  profile: "visor",
  role: null,
  board: {
    arch: "x86_64",
    buttons: null,
    cpu_cores: 8,
    has_accelerator: false,
    has_local_inference: false,
    hw_video_codecs: [],
    local_inference: "none",
    model: "198",
    name: "generic-x86_64",
    npu_tops: 0,
    profile: "generic-x86_64",
    ram_mb: 3913,
    soc: "unknown",
    tier: 3,
    vendor: "unknown",
    version: 1,
  },
  health: {
    cpu_percent: 1,
    disk_percent: 61.4,
    memory_percent: 27.9,
    temperature: null,
    timestamp: "2026-10-19T20:56:15+00:00",
  },
  fc_connected: false,
  fc_port: "",
  fc_baud: 0,
  sim: true,
  gnss: false,
  lora: false,
  sensor_hub: true,
  clock: true,
  capture_storage: true,
  npuTops: 0,
  hasAccelerator: false,
  runtimeMode: "native",
};

const full = (body: object) => body as unknown as LanStatusFull;
const URL = "http://192.168.1.50:8080";

describe("LAN status carries the node flags into the capability store", () => {
  beforeEach(() => {
    useAgentCapabilitiesStore.getState().clear();
    useAgentCapabilitiesStore.setState({ byDevice: {} });
  });

  it("reads a node without a receiver or radio as absent, not unknown", () => {
    applyFullStatus(full(CAPTURED), URL, "visor-dev");
    const caps = selectDeviceCapabilities(useAgentCapabilitiesStore.getState(), "visor-dev");
    expect(caps?.sim).toBe(true);
    expect(capabilityPresence(caps, (c) => c.gnss === true)).toBe("absent");
    expect(capabilityPresence(caps, (c) => c.lora === true)).toBe("absent");
  });

  it("marks GNSS and LoRa present for a ground station that reports them", () => {
    // The same body as a ground-station agent sends it with both lanes fitted.
    const gs = { ...CAPTURED, profile: "ground-station", role: "direct", gnss: true, lora: true };
    applyFullStatus(full(gs), URL, "gs-dev");
    const caps = selectDeviceCapabilities(useAgentCapabilitiesStore.getState(), "gs-dev");
    expect(capabilityPresence(caps, (c) => c.gnss === true)).toBe("present");
    expect(capabilityPresence(caps, (c) => c.lora === true)).toBe("present");
  });

  it("keeps the prior reading when an older agent omits the flags", () => {
    applyFullStatus(full({ ...CAPTURED, gnss: true, lora: true }), URL, "gs-dev");
    const { gnss: _g, lora: _l, ...older } = CAPTURED;
    applyFullStatus(full(older), URL, "gs-dev");
    const caps = selectDeviceCapabilities(useAgentCapabilitiesStore.getState(), "gs-dev");
    expect(caps?.gnss).toBe(true);
    expect(caps?.lora).toBe(true);
  });
});
