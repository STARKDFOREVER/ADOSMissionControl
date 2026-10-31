/**
 * @module PluginClientErrors
 * @description Shared plumbing for the plugin client: the fetch seam, the
 * error type, the transfer deadline, and the agent response parser.
 * @license GPL-3.0-only
 */

import { AgentArmedRefusal, armedRefusalFrom } from "@/lib/agent/agent-client/transport";
import { uploadRefusalCopy } from "../upload-digest";
import type { PluginStateResponse } from "../plugin-client-types";

/**
 * Deadline for the plugin calls that move bulk bytes: two multipart
 * uploads of a `.adosplug` over what may be a radio link, one where the
 * AGENT does the download, and the plugin's own HTTP passthrough. The default
 * 6 s read deadline would abort a legitimate transfer of a few MB; these
 * still need a bound, because unbounded they hold a socket from Chromium's
 * 6-per-origin pool forever.
 */
export const PLUGIN_TRANSFER_TIMEOUT_MS = 120_000;

/** How the client reaches the agent: `timedFetch` straight at the base URL,
 * or a same-origin proxy hop when an HTTPS page cannot reach a plain-HTTP
 * LAN node. Called with the full agent URL the client composed. */
export type AgentFetch = (
  url: string,
  init: RequestInit | undefined,
  timeoutMs?: number,
) => Promise<Response>;

/** Narrow an unknown response body to the sidecar shape: a plain object whose
 * values each carry a `payload` and a numeric `ts_ms`. */
export function isPluginStateResponse(body: unknown): body is PluginStateResponse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }
  for (const value of Object.values(body as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) return false;
    const entry = value as Record<string, unknown>;
    if (!("payload" in entry)) return false;
    if (typeof entry.ts_ms !== "number") return false;
  }
  return true;
}

/** Split a passthrough path into its path (no leading slash) and its query
 * suffix (`?a=b`, or empty). */
export function splitPluginPath(path: string): [string, string] {
  const i = path.indexOf("?");
  const pathPart = (i < 0 ? path : path.slice(0, i)).replace(/^\/+/, "");
  return [pathPart, i < 0 ? "" : path.slice(i)];
}

export class PluginAgentError extends Error {
  readonly code: number;
  readonly kind: string;
  constructor(code: number, kind: string, detail: string) {
    super(detail || kind);
    this.code = code;
    this.kind = kind;
  }
}

/** Parse an agent plugin response: armed refusals, upload refusals and the
 * structured error envelope throw; a success body is returned as `T`. */
export async function parsePluginResponse<T>(res: Response): Promise<T> {
  const text = await res.text().catch(() => "");
  const armed = armedRefusalFrom(res.status, text);
  if (armed) throw armed;
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // fall through; treat as opaque failure
  }
  // Python-served routes nest the refusal under `detail`.
  const detail =
    body && typeof body === "object" && "detail" in body ? body.detail : null;
  if (
    res.status === 409 &&
    detail &&
    typeof detail === "object" &&
    "error" in detail &&
    detail.error === "E_ARMED"
  ) {
    throw new AgentArmedRefusal(text);
  }
  if (!res.ok) {
    const refusal = uploadRefusalCopy(res.status, body);
    if (refusal) {
      throw new PluginAgentError(
        res.status,
        res.status === 429 ? "busy" : "digest_mismatch",
        refusal,
      );
    }
    if (
      body &&
      typeof body === "object" &&
      "ok" in body &&
      (body as { ok: unknown }).ok === false
    ) {
      const b = body as { code?: number; kind?: string; detail?: string };
      throw new PluginAgentError(
        typeof b.code === "number" ? b.code : 1,
        typeof b.kind === "string" ? b.kind : "unknown",
        typeof b.detail === "string" ? b.detail : `HTTP ${res.status}`,
      );
    }
    throw new PluginAgentError(1, "transport_error", `HTTP ${res.status}`);
  }
  return body as T;
}
