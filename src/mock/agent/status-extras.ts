/**
 * @module mock/agent/status-extras
 * @description The demo node's `/api/status/full` command-path keys, in the
 * agent's wire shape: the FC identity verdict and latched system id, the
 * proxy posture with its listening flags, injector arbitration, the
 * unsigned-command risk, agent signing and the forced software encode. A
 * healthy drone: every edge listening, nothing at risk.
 * @license GPL-3.0-only
 */

import type { DiagnosticsSource } from "@/lib/agent/agent-diagnostics";

export const DEMO_STATUS_EXTRAS: DiagnosticsSource = {
  telemetry: {
    fc_system_id: 1,
    fc_device: "/dev/ttyAMA0",
    swarm_precedence: "operator",
    aux_uplink_queue_full_dropped: 0,
    aux_uplink_partial_dropped: 0,
  },
  fc_identity: {
    version: 1,
    enabled: false,
    outcome: "disabled",
    wanted_system_id: 1,
    current_system_id: 1,
    at_ms: 0,
  },
  mavlink_proxy_posture: {
    tcp_listening: true,
    udp_listening: [true, true],
    ws_listening: true,
  },
  agent_commands_unsigned_rejected_risk: false,
  injector_arbitration: "off",
  agent_signing: "off",
  video: { encoder_forced_software: false },
};
