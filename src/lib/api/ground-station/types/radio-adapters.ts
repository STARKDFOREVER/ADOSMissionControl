/**
 * @module api/ground-station/types/radio-adapters
 * @description Per-adapter WFB radio view for multi-adapter ground stations.
 * The same `adapters[]` objects arrive from `GET /api/v1/radio/adapters`, the
 * `wfb-stats` sidecar v2 and `RadioState.adapters`, so they keep the agent's
 * snake_case wire keys everywhere.
 * @license GPL-3.0-only
 */

export type RadioAdapterRole = "rxtx" | "rx" | "tx" | "mesh";

export interface RadioAdapter {
  iface: string;
  mac: string | null;
  usb_path: string | null;
  driver: string | null;
  /** Null when the agent reports a role this app does not know. */
  role: RadioAdapterRole | null;
  antenna: string | null;
  tx_active: boolean | null;
  /** One reading per receive chain; empty when unmeasured. */
  rssi_dbm: number[];
  packets: number | null;
  lost: number | null;
  fec_rec: number | null;
  verified: boolean | null;
}

/** Diversity verdict the agent computes over its receive adapters. */
export interface RadioDiversity {
  rx_adapters: number;
  combined_loss_pct: number | null;
  best_single_loss_pct: number | null;
}

/** `GET /api/v1/radio/adapters`. */
export interface RadioAdaptersResponse {
  adapters: RadioAdapter[];
  diversity: RadioDiversity | null;
}
