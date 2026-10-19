/**
 * @module api/ground-station/types/gnss
 * @description Ground-station GNSS lane: receivers, the RTK base station and
 * the moving-baseline heading, as served by `GET /api/v1/gnss` (snake_case,
 * the agent's own wire shape). A node without the GNSS service answers
 * `present: false` with every other field at its empty value.
 * @license GPL-3.0-only
 */

import type { GnssFix, RtkState } from "@/lib/api/agent/sensors-types";

export type GnssBaseMode = "off" | "survey" | "fixed";
export type GnssBaseState = "off" | "surveying" | "fixed" | "failed";

export interface GnssReceiver {
  id: string;
  source: string;
  model: string | null;
  fix: GnssFix;
  sats: number;
  hdop: number | null;
  lat_deg: number | null;
  lon_deg: number | null;
  h_ellipsoid_m: number | null;
  h_msl_m: number | null;
  rtk: RtkState;
  pps_locked: boolean;
}

export interface GnssPosition {
  lat_deg: number;
  lon_deg: number;
  h_ellipsoid_m: number;
}

export interface GnssRtcmOut {
  msgs_per_s: number;
  bytes_total: number;
  targets: number;
}

export interface GnssBase {
  mode: GnssBaseMode;
  state: GnssBaseState;
  elapsed_s: number | null;
  min_dur_s: number | null;
  accuracy_m: number | null;
  target_accuracy_m: number | null;
  fixed: GnssPosition | null;
  rtcm_out: GnssRtcmOut;
}

export interface GnssHeading {
  available: boolean;
  deg: number | null;
  accuracy_deg: number | null;
  baseline_m: number | null;
}

/** `GET /api/v1/gnss`. */
export interface GnssStatus {
  present: boolean;
  receivers: GnssReceiver[];
  base: GnssBase | null;
  heading: GnssHeading | null;
}

/** `PUT /api/v1/gnss/base` body. The three shapes are the only ones the agent
 * accepts; build them with `gnssBaseBody`. */
export type GnssBaseBody =
  | { mode: "off" }
  | { mode: "survey"; min_dur_s: number; accuracy_m: number }
  | { mode: "fixed"; lat_deg: number; lon_deg: number; h_ellipsoid_m: number };
