/**
 * @module api/ground-station/types/lora
 * @description Ground-station LoRa lane and its multi-region duty governor, as
 * served by `GET /api/v1/lora` and siblings (snake_case wire shape). The band
 * plan comes from the agent's compiled region table; the governor enforces
 * every rule kind the active plan declares and lists only those kinds.
 * @license GPL-3.0-only
 */

export type LoraTransport = "e22" | "meshtastic" | "loopback";

/** Where the active region came from: an explicit LoRa setting, or the node's
 * country setting mapped to its LoRa plan. */
export type LoraRegionSource = "lora.region" | "network.regulatory.region";

export type LoraBlockedReason =
  | "region_unset"
  | "module_band_mismatch"
  | "duty_exhausted"
  | "dwell_time"
  | "lbt_busy"
  | "power_over_limit";

export interface LoraRegion {
  code: string;
  name: string;
  plan_id: string;
  source: LoraRegionSource | string;
  band_mhz: [number, number];
  citation: string | null;
}

export interface LoraChannel {
  freq_mhz: number | null;
  bw_khz: number | null;
  sf: number | null;
  erp_mw: number | null;
  max_erp_mw: number | null;
}

export interface LoraDutyCycleRule {
  kind: "duty_cycle";
  window_s: number;
  limit_pct: number;
  used_pct: number;
  airtime_ms_window: number;
  budget_ms_window: number;
  exhausted: boolean;
  sub_band: string | null;
}

export interface LoraDwellTimeRule {
  kind: "dwell_time";
  limit_ms: number;
  per_s: number;
  last_tx_ms: number | null;
  ok: boolean;
}

export interface LoraLbtRule {
  kind: "lbt";
  threshold_dbm: number;
  listen_us: number;
  last_rssi_dbm: number | null;
  busy_count: number;
}

export interface LoraMaxPowerRule {
  kind: "max_power";
  limit_mw: number;
  configured_mw: number;
  ok: boolean;
}

export type LoraKnownRule =
  | LoraDutyCycleRule
  | LoraDwellTimeRule
  | LoraLbtRule
  | LoraMaxPowerRule;

/** A governor rule. A future agent may add kinds this app does not know; they
 * arrive as a bare `kind` plus fields and render generically. */
export type LoraGovernorRule = LoraKnownRule | ({ kind: string } & Record<string, unknown>);

export interface LoraRefusal {
  rule: string;
  at_ms: number;
}

export interface LoraGovernor {
  rules: LoraGovernorRule[];
  next_tx_allowed_ms: number;
  last_refusal: LoraRefusal | null;
}

/** `GET /api/v1/lora`. */
export interface LoraStatus {
  present: boolean;
  transport: LoraTransport | string | null;
  module_band: string | null;
  region: LoraRegion | null;
  channel: LoraChannel | null;
  node_id: number | null;
  tx_allowed: boolean;
  blocked_reason: LoraBlockedReason | string | null;
  governor: LoraGovernor | null;
  tx: { frames: number; refused: number; refused_by_rule: Record<string, number> } | null;
  rx: { frames: number; crc_errors: number } | null;
  meshtastic: {
    enabled: boolean;
    connected: boolean;
    port: string | null;
    region_preset: string | null;
  } | null;
}

/** One row of `GET /api/v1/lora/regions`, the compiled region table. */
export interface LoraRegionPlan {
  code: string;
  name: string;
  plan_id: string;
  band_mhz: [number, number];
  rules: string[];
  supported_by_module: boolean;
}

export interface LoraRegionsResponse {
  regions: LoraRegionPlan[];
}

/** One received position beacon (`GET /api/v1/lora/beacons`, newest first). */
export interface LoraBeacon {
  node_id: number;
  kind: string;
  lat_deg: number | null;
  lon_deg: number | null;
  alt_m: number | null;
  battery_pct: number | null;
  mode: string | null;
  rssi_dbm: number | null;
  snr_db: number | null;
  received_at_ms: number;
}

export interface LoraBeaconsResponse {
  beacons: LoraBeacon[];
}

/** `PUT /api/v1/lora` body: a region change (null follows the country
 * setting) and/or channel parameters inside the active plan. */
export interface LoraUpdate {
  region?: string | null;
  erp_mw?: number;
  freq_mhz?: number;
  sf?: number;
}
