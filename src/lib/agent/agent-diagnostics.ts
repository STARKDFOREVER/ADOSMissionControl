/**
 * @module agent-diagnostics
 * @description The agent's own command-path verdicts from `/api/status/full`,
 * coerced for the node-detail rows: the FC system id and the identity
 * reconciler's outcome, the direct-GCS proxy edges the router actually holds,
 * the injector arbitration mode, the unsigned-command rejection risk, whether
 * the agent signs its own traffic, and the forced software encode.
 *
 * Every field reads `null` when the agent did not report it: an unmeasured
 * value never renders as a healthy one.
 * @license GPL-3.0-only
 */

import type { FullStatusResponse } from "./types";

/** The identity reconciler's verdict, camelCased. */
export interface FcIdentityVerdict {
  enabled: boolean | null;
  /** `disabled` | `in_sync` | `deferred_armed` | `written` | `error`. */
  outcome: string | null;
  wantedSystemId: number | null;
  currentSystemId: number | null;
}

/** Which direct-GCS proxy edges the router holds right now. */
export interface ProxyListening {
  tcp: boolean | null;
  /** One flag per configured UDP port, in port order. */
  udp: boolean[];
  /** Null when no WebSocket endpoint is configured. */
  ws: boolean | null;
}

export interface AgentDiagnostics {
  fcSystemId: number | null;
  fcIdentity: FcIdentityVerdict | null;
  proxy: ProxyListening | null;
  injectorArbitration: string | null;
  unsignedRejectedRisk: boolean | null;
  agentSigning: string | null;
  encoderForcedSoftware: boolean | null;
  /** Canonical serial path of the FC link. */
  fcDevice: string | null;
  /** Aux uplink frames dropped on a full queue / as partial frames. */
  auxUplinkQueueFullDropped: number | null;
  auxUplinkPartialDropped: number | null;
  /** Which control layer flies the aircraft (`operator` while a human
   * holds pilot-in-command). */
  swarmPrecedence: string | null;
}

function count(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function int(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** The slice of `/api/status/full` the diagnostics read. */
export type DiagnosticsSource = Pick<
  FullStatusResponse,
  | "fc_identity"
  | "mavlink_proxy_posture"
  | "agent_commands_unsigned_rejected_risk"
  | "injector_arbitration"
  | "agent_signing"
> & {
  telemetry?: Record<string, unknown>;
  fc_port?: string;
  video?: { encoder_forced_software?: boolean };
};

/** Coerce the diagnostics out of a consolidated status response. */
export function parseAgentDiagnostics(full: DiagnosticsSource): AgentDiagnostics {
  const identity = record(full.fc_identity);
  const fcIdentity: FcIdentityVerdict | null = identity
    ? {
        enabled: bool(identity.enabled),
        outcome: text(identity.outcome),
        wantedSystemId: int(identity.wanted_system_id),
        currentSystemId: int(identity.current_system_id),
      }
    : null;
  const posture = record(full.mavlink_proxy_posture);
  const proxy: ProxyListening | null = posture
    ? {
        tcp: bool(posture.tcp_listening),
        udp: Array.isArray(posture.udp_listening)
          ? posture.udp_listening.filter((b): b is boolean => typeof b === "boolean")
          : [],
        ws: bool(posture.ws_listening),
      }
    : null;
  const telemetry = record(full.telemetry);
  // The latched heartbeat id rides the vehicle telemetry; the reconciler's
  // own reading covers a node whose FC link is down.
  const fcSystemId =
    int(telemetry?.fc_system_id) ?? fcIdentity?.currentSystemId ?? null;
  return {
    fcSystemId,
    fcIdentity,
    proxy,
    injectorArbitration: text(full.injector_arbitration),
    unsignedRejectedRisk: bool(full.agent_commands_unsigned_rejected_risk),
    agentSigning: text(full.agent_signing),
    encoderForcedSoftware: bool(full.video?.encoder_forced_software),
    // `fc_device` is the canonical path; the reported port is the same link.
    fcDevice: text(telemetry?.fc_device) ?? text(full.fc_port),
    auxUplinkQueueFullDropped: count(telemetry?.aux_uplink_queue_full_dropped),
    auxUplinkPartialDropped: count(telemetry?.aux_uplink_partial_dropped),
    swarmPrecedence: text(telemetry?.swarm_precedence),
  };
}

/** Operator copy for the reconciler outcome. */
export const FC_IDENTITY_OUTCOME_COPY: Record<string, string> = {
  disabled: "Adoption off",
  in_sync: "In sync with the fleet slot",
  deferred_armed: "Change deferred while armed",
  written: "Written; reboot the FC to apply",
  error: "The FC refused the write",
};

/** Operator copy for the injector arbitration mode. */
export const INJECTOR_ARBITRATION_COPY: Record<string, string> = {
  active: "Active",
  inactive_no_local_arbiter: "On, but no arbiter runs on this node",
  off: "Off",
};

/** Operator copy for the agent's own signing state. */
export const AGENT_SIGNING_COPY: Record<string, string> = {
  active: "Signing its own traffic",
  no_key: "On, but no key is stored on the node",
  off: "Off",
};
