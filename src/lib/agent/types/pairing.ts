/**
 * @module AgentTypes
 * @description Agent pairing types.
 * @license GPL-3.0-only
 */

// ── Pairing ─────────────────────────────────────────────

export interface PairingInfo {
  device_id: string;
  name: string;
  version: string;
  board: string;
  paired: boolean;
  /** Null while paired. */
  pairing_code?: string | null;
  /** Null while unpaired. */
  owner_id?: string | null;
  /** Unix seconds; null while unpaired. */
  paired_at?: number | null;
  mdns_host: string;
}

export interface ClaimResponse {
  api_key: string;
  device_id: string;
  name: string;
  mdns_host: string;
}
