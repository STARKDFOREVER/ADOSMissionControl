/**
 * @module AgentTypes
 * @description Agent video and setup/onboarding types.
 * @license GPL-3.0-only
 */

// ── Video ──────────────────────────────────────────────

export interface VideoStatus {
  state: "not_initialized" | "stopped" | "starting" | "running" | "error";
  whep_url: string | null;
  encoder: string | null;
  cameras: {
    cameras: Array<{
      name: string;
      type: string;
      device_path: string;
      hardware_role: string;
    }>;
    assignments: Record<string, unknown>;
  };
  mediamtx: { running: boolean; webrtc_port: number };
  dependencies?: Record<string, { found: boolean; path: string | null }>;
}

// ── Setup / onboarding ─────────────────────────────────

export interface SetupAccessUrl {
  kind: "setup" | "api" | "mission_control" | "video" | "mavlink" | "cloud";
  label: string;
  url: string;
  source: "local" | "hotspot" | "usb" | "mdns" | "cloud" | "configured";
  primary: boolean;
}

export type SetupStepState =
  | "complete"
  | "needs_action"
  | "optional"
  | "blocked"
  | "not_applicable";

export interface SetupStep {
  id: string;
  label: string;
  state: SetupStepState;
  detail: string;
  action_label: string;
  href: string;
}

export interface CloudChoiceStatus {
  mode: "cloud" | "self_hosted" | "local";
  paired: boolean;
  pair_code_required: boolean;
  backend_url: string;
  backend_reachable: boolean;
  last_checked: string | null;
}

export interface ProfileSuggestion {
  detected: "drone" | "ground_station" | "visor" | "unconfigured";
  ground_role_hint: "direct" | "relay" | "receiver";
  ground_score: number;
  air_score: number;
  mesh_capable: boolean;
  signals: Record<string, boolean>;
  confirmed: boolean;
  detected_at: string | null;
}

export type HardwareCheckItemState =
  | "ok"
  | "missing"
  | "warning"
  | "checking"
  | "unknown";

export interface HardwareCheckItem {
  id: string;
  label: string;
  required: boolean;
  state: HardwareCheckItemState;
  detail: string;
  fix_hint: string;
}

export interface HardwareCheckStatus {
  profile: string;
  ground_role: string;
  items: HardwareCheckItem[];
  last_run: string;
}

export interface SetupActionResult {
  ok: boolean;
  message: string;
  data: Record<string, unknown>;
}

export interface SetupStatus {
  version: string;
  device_id: string;
  device_name: string;
  profile: string;
  /** Distributed-RX role for ground-station profile. Empty for drone profile. */
  ground_role?: string;
  setup_complete: boolean;
  setup_finalized?: boolean;
  completion_percent: number;
  next_action: string;
  steps: SetupStep[];
  access_urls: SetupAccessUrl[];
  network: {
    hostname: string;
    mdns_host: string;
    api_port: number;
    hotspot_enabled: boolean;
    hotspot_ssid: string;
    local_ips: string[];
  };
  mavlink: {
    connected: boolean;
    port: string | null;
    baud: number | null;
    websocket_url: string | null;
    public_websocket_url: string | null;
  };
  video: {
    state: string;
    whep_url: string | null;
    public_whep_url: string | null;
    recording: boolean;
  };
  remote_access: {
    provider: "none" | "cloudflare";
    enabled: boolean;
    configured: boolean;
    status: "disabled" | "configured" | "running" | "stopped" | "error";
    public_urls: string[];
    error: string;
  };
  cloud_choice?: CloudChoiceStatus;
  profile_suggestion?: ProfileSuggestion;
  hardware_check?: HardwareCheckStatus | null;
  skipped_steps?: string[];
}
