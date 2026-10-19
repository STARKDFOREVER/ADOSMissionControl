/**
 * @module mock/demo-seed/visor
 * @description The demo Visor node and the sensor, clock, storage, battery and
 * capture-session readings its Overview and Sensors tabs show in demo mode:
 * an indoor rig (no GNSS fix) with the hub IMU at 1 kHz, two global-shutter
 * cameras at 20 Hz and the session clock on the hub's free-running timebase.
 * @license GPL-3.0-only
 */

import type { BatteryHealth } from "@/lib/agent/schemas/battery";
import type {
  CaptureSessionSummary,
  ClockStatus,
  SensorsStatus,
  StorageStatus,
} from "@/lib/api/agent/sensors";
import { useNodeSensorsStore } from "@/stores/node-sensors-store";

/** The demo Visor. Its id is shared by the node-registry presence and the
 * paired-agent row, like the demo workstation and ground station. */
export const DEMO_VISOR = {
  deviceId: "visor-1",
  name: "Visor Alpha",
  board: "ROCK 5B+",
} as const;

const T_NS = 123_456_789_000;
const GIB = 1024 ** 3;

export const DEMO_VISOR_SENSORS: SensorsStatus = {
  present: true,
  rig_id: "visor-pro-01",
  calib_version: "20261019T101500Z-3fa2",
  hub: {
    connected: true,
    transport: "serial:/dev/ttyACM0",
    fw: "ados-sensorhub 0.1.0",
    board: "matek_h743_slim_v3",
    proto_ver: 1,
    uptime_s: 3_621,
    crc_errors: 0,
    dropped: 0,
  },
  fc: null,
  sensors: [
    { id: "imu0", kind: "imu", role: "nav", source: "hub", rate_hz: 1000, expected_hz: 1000, last_t_ns: T_NS, age_ms: 1, sigma_ns: 400_000 },
    { id: "cam_fl", kind: "camera", role: "front_left", source: "vision", rate_hz: 20, expected_hz: 20, last_t_ns: T_NS - 9_000_000, age_ms: 9, sigma_ns: 400_000 },
    { id: "cam_fr", kind: "camera", role: "front_right", source: "vision", rate_hz: 19.8, expected_hz: 20, last_t_ns: T_NS - 11_000_000, age_ms: 11, sigma_ns: 400_000 },
    { id: "baro0", kind: "baro", role: "nav", source: "hub", rate_hz: 25, expected_hz: 25, last_t_ns: T_NS - 20_000_000, age_ms: 20, sigma_ns: 400_000 },
    // No expected rate known for the magnetometer: the UI draws no verdict.
    { id: "mag0", kind: "mag", role: "nav", source: "hub", rate_hz: 50, expected_hz: null, last_t_ns: T_NS - 20_000_000, age_ms: 20, sigma_ns: 400_000 },
    { id: "gnss0", kind: "gnss", role: "nav", source: "hub", rate_hz: 0, expected_hz: 5, last_t_ns: 0, age_ms: null, sigma_ns: -1 },
  ],
  gnss: { fix: "none", sats: 0, hdop: 99.9, rtk: "none" },
};

export const DEMO_VISOR_CLOCK: ClockStatus = {
  present: true,
  timebase: "hub_freerun",
  locked: true,
  sigma_ns: 400_000,
  t_ns: T_NS,
  utc_ns: null,
  sources: [
    { id: "hub", kind: "hub", locked: true, offset_ns: 12_000, skew_ppm: -3.2, sigma_ns: 400_000, last_update_ns: T_NS - 300_000_000 },
    { id: "gnss", kind: "gnss_pps", locked: false, offset_ns: 0, skew_ppm: 0, sigma_ns: -1, last_update_ns: 0 },
  ],
};

export const DEMO_VISOR_STORAGE: StorageStatus = {
  present: true,
  capture_root: "/mnt/nvme0/ados/capture",
  volumes: [
    { mount: "/mnt/nvme0", device: "nvme0n1", fs: "ext4", total_bytes: 931 * GIB, free_bytes: 612 * GIB, rotational: false, is_capture: true },
  ],
  capture: {
    used_bytes: 290 * GIB,
    budget_bytes: Math.round(931 * GIB * 0.85),
    budget_pct: 85,
    floor_free_bytes: 5 * GIB,
    sessions: 12,
    uploaded: 9,
    evict_unuploaded: false,
    state: "ok",
  },
  write_probe: { mbps: 1450.2, measured_at_ns: 120_000_000_000 },
};

export const DEMO_VISOR_SESSIONS: CaptureSessionSummary[] = [
  {
    session_id: "visor-1-20261019T094012Z-a1c3",
    started_at_utc: "2026-10-19T09:40:12Z",
    duration_s: 862,
    size_bytes: Math.round(38.4 * GIB),
    frames: 34_480,
    rooms: ["Hall", "Kitchen", "Bedroom 1", "Bedroom 2", "Bath", "Balcony", "Study"],
    floors: [0],
    timebase: "hub_freerun",
    anchor_source: "operator",
    uploaded: true,
    upload: { state: "committed", bytes_sent: Math.round(38.4 * GIB), bytes_total: Math.round(38.4 * GIB), node: "forge-1", error: null },
  },
];

function demoVisorBattery(nowMs: number): BatteryHealth {
  return {
    enabled: true,
    stale: false,
    updated_at_ms: nowMs,
    thresholds: {
      enabled: true,
      low_cell_mv: 3300,
      critical_cell_mv: 3100,
      cell_divergence_mv: 80,
      voltage_drop_mv_per_s: 500,
      temp_spike_dc_per_s: 50,
      predictive_window_s: 60,
      reserve_percent: 15,
    },
    packs: [
      {
        id: 0,
        source: "ina226",
        stale: false,
        cells_plausible: true,
        cell_voltages_v: [],
        weakest_cell_index: null,
        min_cell_v: null,
        max_cell_v: null,
        divergence_mv: null,
        voltage_v: 14.9,
        current_a: 2.1,
        remaining_pct: 78,
        temperature_c: 31,
        consumed_mah: 1_320,
        consumed_wh: 19.4,
        prediction: { state: "normal", eta_s: 11_400, drop_pct_per_s: 0.006, mean_current_a: 2.1 },
        anomalies: [],
        history: [],
      },
    ],
  };
}

/** Seed the node-sensors store with the demo Visor's readings. */
export function seedVisorReadings(nowMs: number = Date.now()): void {
  useNodeSensorsStore.getState().setReadings(DEMO_VISOR.deviceId, {
    sensors: DEMO_VISOR_SENSORS,
    clock: DEMO_VISOR_CLOCK,
    storage: DEMO_VISOR_STORAGE,
    battery: demoVisorBattery(nowMs),
    sessions: DEMO_VISOR_SESSIONS,
  });
}
