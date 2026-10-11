/**
 * @module server/allowlisted-fetch
 * @description Server-side fetch for proxy routes that relay a file from a
 * fixed set of upstream locations (an SSRF guard).
 *
 *  - Only `https:` URLs with no userinfo and no explicit port pass, and the
 *    host (plus an optional path pattern) must match an allow rule.
 *  - Redirects are followed by hand and every hop is re-checked.
 *  - The body is never buffered here: it is streamed through a byte-counting
 *    `TransformStream` that errors once the ceiling is crossed, and a
 *    `Content-Length` over the ceiling is refused before any body is read.
 *  - One deadline covers every hop and the body read.
 *
 * @license GPL-3.0-only
 */

import { fetchWithTimeout } from "@/lib/net/fetch-with-timeout";

export interface AllowRule {
  /** Exact hostname, compared lowercased. */
  host: string;
  /** When set, the URL path must match. */
  path?: RegExp;
}

export type AllowlistedFetchErrorCode =
  | "not_allowed"
  | "bad_redirect"
  | "upstream_error"
  | "too_large"
  | "timeout"
  | "fetch_failed";

/** A refusal or upstream failure, carrying the HTTP status to answer with. */
export class AllowlistedFetchError extends Error {
  constructor(
    readonly code: AllowlistedFetchErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AllowlistedFetchError";
  }
}

export interface AllowlistedFetchOptions {
  allow: readonly AllowRule[];
  maxBytes: number;
  timeoutMs: number;
  /** The caller's signal (for a route, `request.signal`). */
  signal?: AbortSignal | null;
  /** Redirect hops followed before giving up. Default 5. */
  maxRedirects?: number;
}

/** True when `url` is an https location matching one of `allow`. */
export function isAllowedUrl(url: URL, allow: readonly AllowRule[]): boolean {
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return allow.some(
    (rule) => rule.host.toLowerCase() === host && (!rule.path || rule.path.test(url.pathname)),
  );
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/** Pass chunks through, erroring once more than `maxBytes` have gone by. */
function byteCeiling(maxBytes: number): TransformStream<Uint8Array, Uint8Array> {
  let received = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maxBytes) {
        controller.error(new AllowlistedFetchError("too_large", 413, "Upstream response too large"));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

/**
 * Fetch `url` under the allowlist. Resolves with the final 2xx response whose
 * body is size-capped; rejects with {@link AllowlistedFetchError}.
 */
export async function fetchAllowlisted(
  url: string | URL,
  opts: AllowlistedFetchOptions,
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new AllowlistedFetchError("not_allowed", 400, "url is not a valid absolute URL");
  }
  if (!isAllowedUrl(target, opts.allow)) {
    throw new AllowlistedFetchError("not_allowed", 403, `${target.hostname} is not on the allowlist`);
  }

  const deadline = Date.now() + opts.timeoutMs;
  let res: Response;
  try {
    for (let hop = 0; ; hop++) {
      res = await fetchWithTimeout(target, {
        redirect: "manual",
        timeoutMs: Math.max(1, deadline - Date.now()),
        upstreamSignal: opts.signal ?? null,
      });
      if (res.status < 300 || res.status >= 400) break;
      await res.body?.cancel().catch(() => undefined);
      const location = res.headers.get("location");
      if (!location || hop >= maxRedirects) {
        throw new AllowlistedFetchError(
          "bad_redirect",
          502,
          "upstream redirected too often or without a location",
        );
      }
      target = new URL(location, target);
      if (!isAllowedUrl(target, opts.allow)) {
        throw new AllowlistedFetchError(
          "not_allowed",
          403,
          `redirect to ${target.hostname} is not on the allowlist`,
        );
      }
    }
  } catch (err) {
    if (err instanceof AllowlistedFetchError) throw err;
    if (isAbort(err)) throw new AllowlistedFetchError("timeout", 504, "Upstream timeout");
    throw new AllowlistedFetchError(
      "fetch_failed",
      502,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new AllowlistedFetchError(
      "upstream_error",
      res.status === 404 ? 404 : 502,
      `upstream returned HTTP ${res.status}`,
    );
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > opts.maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new AllowlistedFetchError("too_large", 413, "Upstream response too large");
  }
  if (!res.body) return res;
  return new Response(res.body.pipeThrough(byteCeiling(opts.maxBytes)), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

/** Read a size-capped body from {@link fetchAllowlisted} into memory. */
export async function readAllowlistedBody(res: Response): Promise<ArrayBuffer> {
  try {
    return await res.arrayBuffer();
  } catch (err) {
    if (err instanceof AllowlistedFetchError) throw err;
    if (isAbort(err)) throw new AllowlistedFetchError("timeout", 504, "Upstream timeout");
    throw new AllowlistedFetchError(
      "fetch_failed",
      502,
      err instanceof Error ? err.message : String(err),
    );
  }
}
