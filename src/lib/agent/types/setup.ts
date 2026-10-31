/**
 * @module AgentTypes
 * @description Agent video and setup-action types. The setup status payload
 * and its nested blocks are generated from the agent's schema
 * (`@/lib/agent/agent-api.generated`).
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

export interface SetupActionResult {
  ok: boolean;
  message: string;
  data: Record<string, unknown>;
}
