"use client";

/**
 * @module components/fc/security/signing/UnsignedRiskBanner
 * @description The warning shown while the node reports that the flight
 * controller enforces signing on a serial link the agent cannot sign on. The
 * FC then drops the agent's own frames (stream rates, the parameter sweep,
 * swarm setpoints). Renders nothing unless the risk is reported `true`; an
 * unmeasured (null) risk is not a warning.
 */

import { AlertTriangle } from "lucide-react";

export const UNSIGNED_RISK_COPY =
  "Agent traffic may be rejected: FC signing is on and the agent cannot sign";

export function UnsignedRiskBanner({ risk }: { risk: boolean | null | undefined }) {
  if (risk !== true) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-xs text-text-secondary"
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-status-warning" aria-hidden="true" />
      <span>{UNSIGNED_RISK_COPY}</span>
    </div>
  );
}
