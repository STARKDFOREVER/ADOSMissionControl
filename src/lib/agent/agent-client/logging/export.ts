/**
 * @module agent/agent-client/logging
 * @description Bulk export: streamed on the LAN, paged over a relay.
 * @license GPL-3.0-only
 */

import type { RequestContext } from "../transport";
import type { ExportFormat, ExportParams, LoggingSource } from "./types";
import {
  RELAY_PAGE_ROWS,
  EXPORT_IDLE_TIMEOUT_MS,
  TIER_SOURCE,
  isHardError,
  TierHardError,
  tierBase,
  withIdleDeadline,
  buildQueryString,
  fetchTier,
} from "./tiers";
import { asEnvelope } from "./legacy";

/** Stream a bulk export. Returns the raw byte stream so the caller can
 * pipe it to a Blob/download without buffering the whole window. The
 * format defaults to `jsonl.zst`. Export is a store capability served by
 * the proxy bridge (legacy has no export endpoint); throws on a store-less
 * agent (the caller surfaces "export unavailable") and throws the refusal
 * on an auth or request error. Over a relay, which carries unary
 * request/response only, the window is paged through the query instead
 * (see {@link pagedExport}) and always arrives as plain `jsonl`.
 */
export async function exportWindow(
  ctx: RequestContext,
  params: ExportParams = {},
): Promise<{
  stream: ReadableStream<Uint8Array>;
  format: ExportFormat;
  source: LoggingSource;
}> {
  if (ctx.relay) return pagedExport(ctx, params);
  const format: ExportFormat = params.format ?? "jsonl.zst";
  const qs = new URLSearchParams(buildQueryString(params));
  qs.set("format", format);
  const query = qs.toString();

  let origin: string;
  let prefix: string;
  try {
    ({ origin, prefix } = tierBase(ctx, "proxy"));
  } catch {
    throw new Error("export unavailable: unusable base url");
  }
  const headers: Record<string, string> = {};
  if (ctx.apiKey) headers["X-ADOS-Key"] = ctx.apiKey;

  // An inactivity deadline, not a total one: it covers the wait for the
  // response headers here and then every chunk wait inside the returned
  // stream, so a dead socket aborts while a long, still-arriving window
  // is never cut off.
  const controller = new AbortController();
  const connectTimer = setTimeout(
    () => controller.abort(new DOMException("export stalled", "TimeoutError")),
    EXPORT_IDLE_TIMEOUT_MS,
  );
  let res: Response;
  try {
    res = await fetch(`${origin}${prefix}/export?${query}`, {
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(
      `export unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(connectTimer);
  }
  if (!res.ok) {
    if (isHardError(res.status)) {
      throw new Error(`export refused: ${res.status}`);
    }
    throw new Error(`export unavailable: ${res.status}`);
  }
  if (!res.body) {
    throw new Error("export unavailable: empty export body");
  }
  return {
    stream: withIdleDeadline(res.body, controller, EXPORT_IDLE_TIMEOUT_MS),
    format,
    source: TIER_SOURCE.proxy,
  };
}

/**
 * The relayed export: walk the store's query with its keyset cursor, one
 * {@link RELAY_PAGE_ROWS}-row page per relay round trip, and emit each
 * wire row as one JSONL line (the same rows, filters and line format the
 * store's own export writes). The first page is read before returning so
 * a refusal or a store that is not serving throws like the LAN export;
 * later pages are read as the consumer pulls. Only the proxy tier is
 * asked, because the legacy route has no export.
 */
async function pagedExport(
  ctx: RequestContext,
  params: ExportParams,
): Promise<{
  stream: ReadableStream<Uint8Array>;
  format: ExportFormat;
  source: LoggingSource;
}> {
  const readPage = async (
    cursor: string | undefined,
  ): Promise<{ rows: unknown[]; next: string | null }> => {
    // `format` is not a query parameter; the window's filters are.
    const query = buildQueryString({ ...params, limit: RELAY_PAGE_ROWS, cursor });
    let body: unknown;
    try {
      body = await fetchTier(ctx, "proxy", "/query", query);
    } catch (err) {
      if (err instanceof TierHardError) throw new Error(`export refused: ${err.status}`);
      throw new Error(
        `export unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const env = asEnvelope(body, TIER_SOURCE.proxy, (raw) => raw);
    return { rows: env.data, next: env.page.next_cursor };
  };

  const encoder = new TextEncoder();
  let page = await readPage(params.cursor);
  let done = false;
  const seenCursors = new Set<string>();
  const stream = new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      if (done) {
        controller.close();
        return;
      }
      if (page.rows.length > 0) {
        controller.enqueue(
          encoder.encode(page.rows.map((row) => `${JSON.stringify(row)}\n`).join("")),
        );
      }
      // A repeated cursor would loop forever; treat it as the end.
      const next = page.next;
      if (next === null || page.rows.length === 0 || seenCursors.has(next)) {
        done = true;
        return;
      }
      seenCursors.add(next);
      page = await readPage(next);
    },
  });
  return { stream, format: "jsonl", source: TIER_SOURCE.proxy };
}
