/**
 * @module agent/agent-client/logging
 * @description Tier resolution, transport constants and query-string helpers.
 * @license GPL-3.0-only
 */

import type { RequestContext } from "../transport";
import { AGENT_FETCH_TIMEOUT_MS, timedFetch } from "../timeout";
import type { QueryParams, LoggingSource } from "./types";

// ── Tier resolution ───────────────────────────────────────────────────

/** The agent REST port; the proxy bridge and the legacy route both live here. */
export const FASTAPI_PORT = 8080;
export const PROXY_PREFIX = "/api/v2/observability";

/** Cadence of the relayed live tail's query poll. */
export const RELAY_TAIL_POLL_MS = 2000;
/** Rows per relayed tail poll page and per relayed export page. A relayed
 * response body is capped near 69 KB, and a stored log row with its fields
 * runs a few hundred bytes, so a page this size leaves headroom. */
export const RELAY_PAGE_ROWS = 100;
/** Pages one relayed tail poll may walk. A burst beyond this many rows in
 * one poll interval skips ahead to the newest rather than lagging behind. */
export const RELAY_TAIL_MAX_PAGES = 10;

/** Longest the streaming export may wait for its next bytes (headers first,
 * then each chunk). An inactivity bound, not a total one: a large window
 * that keeps arriving is never cut off, while a silently-dead socket is. */
export const EXPORT_IDLE_TIMEOUT_MS = AGENT_FETCH_TIMEOUT_MS * 10;

/** The push write waits for the agent's own result poll (up to ~8 s) before
 * it answers, so its deadline sits well above the read default. */
export const PUSH_TIMEOUT_MS = AGENT_FETCH_TIMEOUT_MS * 10;

export type Tier = "proxy" | "legacy";

export const TIER_ORDER: readonly Tier[] = ["proxy", "legacy"];

export const TIER_SOURCE: Record<Tier, LoggingSource> = {
  proxy: "proxy",
  legacy: "legacy",
};

/** HTTP statuses that mean "this tier cannot serve this surface" and so
 * justify cascading to the next tier. A 502 is included because the
 * FastAPI proxy returns it when the logd socket is down. */
export const CASCADE_STATUSES = new Set([404, 501, 502, 503]);

/** Statuses that are real errors for the request, not a missing surface:
 * never cascade on these, surface the error instead. */
export function isHardError(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 429;
}

export class TierUnavailableError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "TierUnavailableError";
  }
}

export class TierHardError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TierHardError";
  }
}

/** Build the base origin for a tier from the agent's REST base URL. The
 * host is taken from `ctx.baseUrl` (which already carries the resolved
 * hostname/IP) and only the port + path prefix change per tier.
 *
 * Under relay there is no port to swap: `ctx.baseUrl` is the ground
 * station's relay-proxy prefix, which already lands on the drone's own
 * `:8080`. Rebuilding an origin here would discard the prefix and dial the
 * GROUND STATION's own REST port, returning the ground station's own logs
 * labelled as the drone's. So the relay keeps the prefix verbatim and
 * appends the tier path — no `new URL()`, no port surgery. */
export function tierBase(
  ctx: RequestContext,
  tier: Tier,
): { origin: string; prefix: string } {
  const prefix = tier === "proxy" ? `${PROXY_PREFIX}/v1` : "/api/logs";
  if (ctx.relay) {
    return { origin: ctx.baseUrl, prefix };
  }
  const u = new URL(ctx.baseUrl);
  // http: on LAN; https: cloud origins won't take this path
  return { origin: `${u.protocol}//${u.hostname}:${FASTAPI_PORT}`, prefix };
}

/** Wrap an export body so a read that waits longer than `idleMs` for the
 * next chunk aborts the request. The timer runs only while a read is
 * outstanding, so a consumer that pauses is never mistaken for a stall. */
export function withIdleDeadline(
  body: ReadableStream<Uint8Array>,
  controller: AbortController,
  idleMs: number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(out) {
      const timer = setTimeout(
        () => controller.abort(new DOMException("export stalled", "TimeoutError")),
        idleMs,
      );
      try {
        const { done, value } = await reader.read();
        if (done) out.close();
        else out.enqueue(value);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** The push route takes an integer session id; anything else would be
 * refused with a 400, so it is refused here with the reason. */
export function pushSessionId(session: string | undefined): number | undefined {
  if (session === undefined) return undefined;
  const n = Number(session);
  if (!Number.isInteger(n)) {
    throw new Error(`push failed: session ${session} is not a store session id`);
  }
  return n;
}

export function appendList(qs: URLSearchParams, key: string, vals?: string[]): void {
  if (!vals) return;
  for (const v of vals) {
    if (v != null && v !== "") qs.append(key, v);
  }
}

export function buildQueryString(params: QueryParams): string {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.kind) qs.set("kind", params.kind);
  if (params.level) qs.set("level", params.level);
  if (params.text) qs.set("text", params.text);
  if (params.session) qs.set("session", params.session);
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  appendList(qs, "source", params.source);
  appendList(qs, "metric", params.metric);
  appendList(qs, "event_kind", params.event_kind);
  return qs.toString();
}
/** Issue one fetch against a tier and return the parsed JSON body, or
 * throw a TierUnavailable / TierHard error. Cloud (https) origins never
 * take the LAN path — they short-circuit as unavailable so the caller
 * degrades gracefully. */
export async function fetchTier(
  ctx: RequestContext,
  tier: Tier,
  path: string,
  query: string,
): Promise<unknown> {
  let origin: string;
  let prefix: string;
  try {
    ({ origin, prefix } = tierBase(ctx, tier));
  } catch {
    throw new TierUnavailableError(null, "unusable base url");
  }
  // Legacy only serves the logs path; map a generic `/query` onto it.
  const url =
    tier === "legacy"
      ? `${origin}${prefix}${query ? `?${query}` : ""}`
      : `${origin}${prefix}${path}${query ? `?${query}` : ""}`;

  const headers: Record<string, string> = {};
  if (ctx.apiKey) headers["X-ADOS-Key"] = ctx.apiKey;

  let res: Response;
  try {
    // A deadline is mandatory: a half-open socket would otherwise hang
    // this await forever, the catch would never run, and the tier
    // cascade would never advance past a silently-dead tier. An abort
    // surfaces here as a network-style error and cascades like any other.
    // The relay client carries a longer default deadline than a LAN read
    // (`ctx.defaultTimeoutMs`); without threading it, every relay logging
    // read aborts at 6 s under a 10 s ground bound. `undefined` on the LAN
    // client falls back to `AGENT_FETCH_TIMEOUT_MS` inside `timedFetch`.
    res = await timedFetch(url, { headers }, ctx.defaultTimeoutMs);
  } catch (err) {
    // Network error / DNS / mixed-content block / timeout — cascade.
    throw new TierUnavailableError(
      null,
      err instanceof Error ? err.message : "network error",
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (isHardError(res.status)) {
      throw new TierHardError(res.status, `${res.status}: ${detail}`);
    }
    if (CASCADE_STATUSES.has(res.status)) {
      throw new TierUnavailableError(res.status, `${res.status}: ${detail}`);
    }
    // Any other status (5xx etc.) is treated as a hard error for this call.
    throw new TierHardError(res.status, `${res.status}: ${detail}`);
  }
  return (await res.json()) as unknown;
}

/** Run `path` across the tiers, returning the first success + the tier
 * that produced it. Every call tries the tiers in natural order: the
 * legacy route answers any path, so letting a tier that answered last time
 * jump the queue would stop the proxy from ever being retried after one
 * outage. */
export async function resolveTier(
  ctx: RequestContext,
  path: string,
  query: string,
): Promise<{ body: unknown; tier: Tier }> {
  let lastErr: Error | null = null;
  for (const tier of TIER_ORDER) {
    try {
      const body = await fetchTier(ctx, tier, path, query);
      return { body, tier };
    } catch (err) {
      if (err instanceof TierHardError) {
        // Real error — do not mask it behind a fallback.
        throw new Error(err.message);
      }
      lastErr = err instanceof Error ? err : new Error(String(err));
      // TierUnavailable — keep cascading.
    }
  }
  throw new Error(
    `logd unavailable: ${lastErr ? lastErr.message : "no tier answered"}`,
  );
}
