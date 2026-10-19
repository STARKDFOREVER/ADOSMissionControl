/**
 * @module mock/demo-seed/ground-station-lanes
 * @description Demo GNSS and LoRa lanes for the demo ground station. In demo
 * the ground-station REST client is null, so the GNSS and LoRa tabs read these
 * seeded stores untouched. The RTK base starts surveying and, as a demo-only
 * effect, settles to a fixed position after a short timer.
 * @license GPL-3.0-only
 */

import { useGnssStore } from "@/stores/ground-station/gnss-store";
import { useLoraStore } from "@/stores/ground-station/lora-store";
import type {
  GnssBase,
  GnssStatus,
  LoraBeacon,
  LoraRegionPlan,
  LoraStatus,
} from "@/lib/api/ground-station/types";

const BASE_LAT = 12.9716;
const BASE_LON = 77.5946;
const BASE_H_ELL = 920.4;

/** How long the demo survey-in runs before it settles to fixed. */
export const DEMO_SURVEY_FLIP_MS = 20_000;

const DEMO_SURVEYING_BASE: GnssBase = {
  mode: "survey",
  state: "surveying",
  elapsed_s: 120,
  min_dur_s: 300,
  accuracy_m: 3.1,
  target_accuracy_m: 2.0,
  fixed: null,
  rtcm_out: { msgs_per_s: 0, bytes_total: 0, targets: 0 },
};

const DEMO_FIXED_BASE: GnssBase = {
  mode: "survey",
  state: "fixed",
  elapsed_s: 300,
  min_dur_s: 300,
  accuracy_m: 1.8,
  target_accuracy_m: 2.0,
  fixed: { lat_deg: BASE_LAT, lon_deg: BASE_LON, h_ellipsoid_m: BASE_H_ELL },
  rtcm_out: { msgs_per_s: 6, bytes_total: 184_320, targets: 2 },
};

export const DEMO_GNSS: GnssStatus = {
  present: true,
  receivers: [
    {
      id: "gnss0",
      source: "hub",
      model: "u-blox M10",
      fix: "3d",
      sats: 14,
      hdop: 0.8,
      lat_deg: BASE_LAT,
      lon_deg: BASE_LON,
      h_ellipsoid_m: BASE_H_ELL,
      h_msl_m: 1006.1,
      rtk: "none",
      pps_locked: true,
    },
  ],
  base: DEMO_SURVEYING_BASE,
  heading: { available: false, deg: null, accuracy_deg: null, baseline_m: null },
};

export const DEMO_LORA: LoraStatus = {
  present: true,
  transport: "e22",
  module_band: "850-930",
  region: {
    code: "IN",
    name: "India",
    plan_id: "IN865",
    source: "network.regulatory.region",
    band_mhz: [865.0, 867.0],
    citation: "G.S.R. 853(E), 2021",
  },
  channel: { freq_mhz: 866.0, bw_khz: 125, sf: 9, erp_mw: 25, max_erp_mw: 25 },
  node_id: 17,
  tx_allowed: true,
  blocked_reason: null,
  governor: {
    rules: [
      {
        kind: "duty_cycle",
        window_s: 3600,
        limit_pct: 1.0,
        used_pct: 0.4,
        airtime_ms_window: 14_400,
        budget_ms_window: 36_000,
        exhausted: false,
        sub_band: "865.0-867.0",
      },
      { kind: "max_power", limit_mw: 25, configured_mw: 25, ok: true },
    ],
    next_tx_allowed_ms: 0,
    last_refusal: null,
  },
  tx: {
    frames: 120,
    refused: 0,
    refused_by_rule: { duty_cycle: 0, dwell_time: 0, lbt: 0, max_power: 0, region_unset: 0 },
  },
  rx: { frames: 340, crc_errors: 2 },
  meshtastic: { enabled: false, connected: false, port: null, region_preset: "IN" },
};

/** A slice of the compiled region table: plans the 850-930 MHz module meets,
 * plans it cannot (JP / KR / TW grid and hop-count rules, CN470 out of band)
 * and a research-only row with no verified rules. */
export const DEMO_LORA_REGIONS: LoraRegionPlan[] = [
  { code: "IN", name: "India", plan_id: "IN865", band_mhz: [865.0, 867.0], rules: ["duty_cycle", "max_power"], supported_by_module: true },
  { code: "EU", name: "European Union (ETSI)", plan_id: "EU868", band_mhz: [863.0, 870.0], rules: ["duty_cycle", "max_power", "lbt"], supported_by_module: true },
  { code: "US", name: "United States (FCC)", plan_id: "US915", band_mhz: [902.0, 928.0], rules: ["dwell_time", "max_power"], supported_by_module: true },
  { code: "AU", name: "Australia", plan_id: "AU915", band_mhz: [915.0, 928.0], rules: ["max_power"], supported_by_module: true },
  { code: "JP", name: "Japan", plan_id: "AS923-1-JP", band_mhz: [920.5, 923.5], rules: ["lbt", "dwell_time", "max_power"], supported_by_module: false },
  { code: "KR", name: "South Korea", plan_id: "KR920", band_mhz: [920.9, 923.3], rules: ["lbt", "dwell_time", "max_power"], supported_by_module: false },
  { code: "TW", name: "Taiwan", plan_id: "AS923-1-TW", band_mhz: [920.0, 925.0], rules: ["dwell_time", "max_power"], supported_by_module: false },
  { code: "CN", name: "China", plan_id: "CN470", band_mhz: [470.0, 510.0], rules: [], supported_by_module: false },
];

function demoBeacons(now: number): LoraBeacon[] {
  return [
    { node_id: 42, kind: "beacon", lat_deg: 12.9718, lon_deg: 77.5951, alt_m: 42, battery_pct: 78, mode: "AUTO", rssi_dbm: -92, snr_db: 7.5, received_at_ms: now - 12_000 },
    { node_id: 43, kind: "beacon", lat_deg: 12.9702, lon_deg: 77.5938, alt_m: 38, battery_pct: 64, mode: "LOITER", rssi_dbm: -101, snr_db: 2.0, received_at_ms: now - 41_000 },
  ];
}

let surveyTimer: ReturnType<typeof setTimeout> | undefined;

/** Seed the GNSS and LoRa stores for the demo ground station. Re-seeding
 * restarts the survey-in. */
export function seedGroundStationLanes(): void {
  const now = Date.now();
  useGnssStore.setState({
    gnss: DEMO_GNSS,
    gnssFor: null,
    error: null,
    fetchedAt: now,
    applying: false,
  });
  useLoraStore.setState({
    status: DEMO_LORA,
    regions: DEMO_LORA_REGIONS,
    beacons: demoBeacons(now),
    loraFor: null,
    error: null,
    fetchedAt: now,
    applying: false,
  });
  clearTimeout(surveyTimer);
  surveyTimer = setTimeout(() => {
    const gnss = useGnssStore.getState().gnss;
    if (!gnss || gnss.base?.state !== "surveying") return;
    useGnssStore.setState({
      gnss: {
        ...gnss,
        base: DEMO_FIXED_BASE,
        receivers: gnss.receivers.map((r) => ({ ...r, fix: "rtk_fixed", rtk: "fixed", sats: 18, hdop: 0.6 })),
      },
      fetchedAt: Date.now(),
    });
  }, DEMO_SURVEY_FLIP_MS);
}
