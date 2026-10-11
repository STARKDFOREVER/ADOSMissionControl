/**
 * @module agent/local-pair/dashboard-session
 * @description A dashboard PIN session for a node Mission Control holds no
 * key for. An unpaired node refuses its data plane to an operator-LAN caller
 * without a PIN session, its ground-station WebSocket relays included: a
 * browser on the LAN unlocks with the node's dashboard PIN, and every later
 * request (and every WS ticket mint) carries the session header instead of
 * `X-ADOS-Key`.
 *
 * Sessions are kept in memory per node origin, never persisted: a reload asks
 * for the PIN again, the same as the node's own dashboard.
 * @license GPL-3.0-only
 */

import { PairClientError } from "./errors";
import { normaliseHost, safeJson } from "./transport";

/** The header the agent's front accepts in place of `X-ADOS-Key`. */
export const DASHBOARD_SESSION_HEADER = "X-ADOS-Dashboard-Session";

interface HeldSession {
  token: string;
  /** Unix seconds the agent stops honouring the token. */
  expiresAt: number;
}

const sessions = new Map<string, HeldSession>();

function originOf(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** The live session held for `baseUrl`, or null when none is held or it has
 * expired. */
export function dashboardSessionFor(
  baseUrl: string,
  nowUnixS: number = Date.now() / 1000,
): string | null {
  const key = originOf(baseUrl);
  const held = sessions.get(key);
  if (!held) return null;
  if (held.expiresAt <= nowUnixS) {
    sessions.delete(key);
    return null;
  }
  return held.token;
}

/** Drop the session held for `baseUrl` (signed out, or the node refused it). */
export function forgetDashboardSession(baseUrl: string): void {
  sessions.delete(originOf(baseUrl));
}

/** Copy for a refused PIN entry, by the agent's answer. */
function refusalCopy(status: number, body: unknown, nowUnixS: number): string {
  const rec = body && typeof body === "object" ? body : null;
  if (status === 423 && rec && "error" in rec && rec.error === "E_PIN_LOCKED") {
    const retry = "retry_after_s" in rec && typeof rec.retry_after_s === "number"
      ? rec.retry_after_s
      : null;
    const wait = retry !== null ? ` Try again in ${Math.max(1, Math.ceil(retry / 60))} min,` : "";
    return `Too many wrong PIN attempts from across the network: this node's dashboard is locked for every device.${wait} or reset the PIN from a Mission Control that holds the node's key.`;
  }
  if (status === 429) {
    const until = rec && "locked_until" in rec && typeof rec.locked_until === "number"
      ? rec.locked_until
      : null;
    const wait = until !== null ? ` for ${Math.max(1, Math.ceil((until - nowUnixS) / 60))} min` : "";
    return `Too many wrong PINs from this device: it is locked out${wait}.`;
  }
  if (status === 401) {
    const left = rec && "remaining_attempts" in rec && typeof rec.remaining_attempts === "number"
      ? rec.remaining_attempts
      : null;
    return left !== null ? `Wrong PIN. ${left} attempts left.` : "Wrong PIN.";
  }
  if (status === 409) return "This node has no dashboard PIN set.";
  return `PIN check failed: HTTP ${status}`;
}

/**
 * Enter the node's dashboard PIN (`POST /api/dashboard/pin/verify`) and hold
 * the session it returns for `hostname`. Throws a {@link PairClientError}
 * carrying operator copy on a wrong PIN, a per-device lock (429) or a
 * node-wide lock (423 `E_PIN_LOCKED`, scope `node`).
 */
export async function verifyDashboardPin(
  hostname: string,
  pin: string,
  signal?: AbortSignal,
): Promise<string> {
  const host = normaliseHost(hostname);
  const resp = await fetch(`${host}/api/dashboard/pin/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ pin }),
    signal,
  });
  const body = await safeJson(resp);
  const nowUnixS = Date.now() / 1000;
  if (!resp.ok) {
    throw new PairClientError("pinVerifyFailedError", refusalCopy(resp.status, body, nowUnixS), {
      status: resp.status,
      statusText: resp.statusText,
    });
  }
  const session =
    body && typeof body === "object" && "session" in body && typeof body.session === "string"
      ? body.session
      : null;
  if (!session) {
    throw new PairClientError("pinVerifyFailedError", "The node answered without a session.", {
      status: resp.status,
      statusText: resp.statusText,
    });
  }
  const expiresAt =
    body && typeof body === "object" && "expires_at" in body && typeof body.expires_at === "number"
      ? body.expires_at
      : nowUnixS;
  sessions.set(originOf(host), { token: session, expiresAt });
  return session;
}
