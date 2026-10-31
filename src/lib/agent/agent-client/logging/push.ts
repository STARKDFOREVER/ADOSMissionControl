/**
 * @module agent/agent-client/logging
 * @description Explicit push of a store window to the paired cloud account.
 * @license GPL-3.0-only
 */

import type { RequestContext } from "../transport";
import { timedFetch } from "../timeout";
import type { PushParams, PushResult } from "./types";
import { FASTAPI_PORT, PUSH_TIMEOUT_MS, pushSessionId } from "./tiers";

/** Explicitly export a chosen window from the durable store to the paired
 * cloud account. Unlike the read surfaces, push is a WRITE and has exactly
 * ONE path: the agent's REST process at `:8080/api/logs/push`. There is no
 * tier cascade, because the agent process is the only thing that owns the
 * writer-control socket that flips a row as exported. Cloud (https) origins
 * short-circuit so a remote session degrades to "push unavailable" rather
 * than posting against the wrong host; a relayed client posts through the
 * relay-proxy prefix, which already lands on the drone's own `:8080`, so it
 * must not rebuild an origin.
 *
 * Resolves with `pending: true` when the agent accepted the request but the
 * cloud service had not answered yet. Throws when the service answered
 * with an error or without exporting the window. */
export async function pushWindow(
  ctx: RequestContext,
  params: PushParams = {},
): Promise<PushResult> {
  let origin: string;
  if (ctx.relay) {
    origin = ctx.baseUrl;
  } else {
    try {
      const u = new URL(ctx.baseUrl);
      if (u.protocol === "https:") throw new Error("cloud origin");
      origin = `${u.protocol}//${u.hostname}:${FASTAPI_PORT}`;
    } catch {
      throw new Error("push unavailable: unusable base url");
    }
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (ctx.apiKey) headers["X-ADOS-Key"] = ctx.apiKey;
  const body = JSON.stringify({
    session: pushSessionId(params.session),
    since: params.since,
    kinds: params.kinds,
  });
  const res = await timedFetch(
    `${origin}/api/logs/push`,
    { method: "POST", headers, body },
    PUSH_TIMEOUT_MS,
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`push failed ${res.status}: ${detail}`);
  }
  const j = (await res.json()) as Record<string, unknown>;
  if (typeof j.error === "string" && j.error) {
    throw new Error(`push failed: ${j.error}`);
  }
  const pending = j.pending === true;
  if (!pending && j.pushed !== true) {
    throw new Error("push failed: the window was not exported");
  }
  return {
    pending,
    window_id: j.window_id == null ? null : String(j.window_id),
    sha256: typeof j.sha256 === "string" ? j.sha256 : null,
    bytes: Number(j.bytes ?? 0),
    rows: Number(j.rows ?? 0),
    deduped: j.deduped === true,
    synced: j.synced === true,
  };
}
