/**
 * @module mock/demo-seed/adapter-history
 * @description A minute of RSSI history for the demo ground stations' WFB
 * adapters, so the Radio tab's per-chain sparklines have a trace in demo mode
 * (the demo capability reading is static, so live samples never accumulate).
 * @license GPL-3.0-only
 */

import { DEMO_GROUND_STATION, DEMO_GROUND_STATION_DIRECT } from "@/mock/drones";
import { MOCK_GS_ADAPTERS } from "@/mock/agent/radio";
import { useAdapterRssiHistoryStore } from "@/stores/ground-station/adapter-rssi-history-store";

const SAMPLES = 60;

/** A deterministic wobble (a few dB) around each chain's seeded RSSI. */
function wobble(base: number, sample: number, chain: number): number {
  return Math.round(base + 2.5 * Math.sin(sample / 4 + chain * 1.7) + 1.5 * Math.sin(sample / 1.3));
}

export function seedDemoAdapterHistory(): void {
  const { record } = useAdapterRssiHistoryStore.getState();
  for (const node of [DEMO_GROUND_STATION.deviceId, DEMO_GROUND_STATION_DIRECT.deviceId]) {
    for (let i = 0; i < SAMPLES; i++) {
      record(
        node,
        MOCK_GS_ADAPTERS.map((a) => ({
          ...a,
          rssi_dbm: a.rssi_dbm.map((v, chain) => wobble(v, i, chain)),
        })),
      );
    }
  }
}
