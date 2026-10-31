/**
 * @module agent/agent-client/logging
 * @description The `LoggingService` client.
 * @license GPL-3.0-only
 */

import type { RequestContext } from "../transport";
import { AGENT_FETCH_TIMEOUT_MS } from "../timeout";
import {
  normaliseBucket,
  normaliseHealth,
  normaliseQueryRow,
  normaliseSessionRow,
  normaliseStats,
} from "../logging-wire";
import { openLogTail, type LogTail, type LogTailHandlers } from "../log-tail";
import type {
  LoggingRow,
  SessionRow,
  AggregatePoint,
  QueryParams,
  AggregateParams,
  ExportFormat,
  ExportParams,
  PushParams,
  PushResult,
  SessionListParams,
  TailParams,
  LoggingSource,
  LoggingEnvelope,
  StatsResponse,
  HealthzResponse,
} from "./types";
import {
  TIER_SOURCE,
  tierBase,
  appendList,
  buildQueryString,
  resolveTier,
} from "./tiers";
import { wrapLegacy, emptyLegacyEnvelope, asEnvelope } from "./legacy";
import { pollRelayTail } from "./relay-tail";
import { exportWindow } from "./export";
import { pushWindow } from "./push";

export class LoggingService {
  private ctx: RequestContext;

  constructor(ctx: RequestContext) {
    this.ctx = ctx;
  }

  // ── query ────────────────────────────────────────────────────────────

  /** Keyset-paginated rows. Generic over the row type for the chosen
   * `kind` (defaults to logs). */
  async query<T = LoggingRow>(
    params: QueryParams = {},
  ): Promise<LoggingEnvelope<T>> {
    const query = buildQueryString(params);
    const { body, tier } = await resolveTier(this.ctx, "/query", query);
    if (tier === "legacy") {
      // Legacy answers a flat array (or `{ entries: [...] }`); wrap it.
      const arr = Array.isArray(body)
        ? body
        : Array.isArray((body as { entries?: unknown[] })?.entries)
          ? (body as { entries: unknown[] }).entries
          : [];
      return wrapLegacy(arr) as unknown as LoggingEnvelope<T>;
    }
    const kind = params.kind ?? "logs";
    return asEnvelope<T>(
      body,
      TIER_SOURCE[tier],
      (raw, idx) => normaliseQueryRow(kind, raw, idx) as T,
    );
  }

  /** Async iterator that walks every page of a query (newest first). Stops
   * when the server returns a null cursor. Caps total pages so a runaway
   * cursor can never spin forever. */
  async *queryAll<T = LoggingRow>(
    params: QueryParams = {},
    opts: { maxPages?: number } = {},
  ): AsyncGenerator<T, void, void> {
    const maxPages = opts.maxPages ?? 100;
    let cursor: string | undefined = params.cursor;
    let pages = 0;
    do {
      const page: LoggingEnvelope<T> = await this.query<T>({ ...params, cursor });
      for (const row of page.data) yield row;
      cursor = page.page.next_cursor ?? undefined;
      pages += 1;
      // Legacy answers one page with a null cursor, so this loop exits at once.
      if (page.data.length === 0) break;
    } while (cursor && pages < maxPages);
  }

  // ── tail ─────────────────────────────────────────────────────────────

  /** Open a live log tail (`kind=logs`). Each row reaches `handlers.onRow`
   * already normalised, and a dropped or refused tail reaches
   * `handlers.onError` once.
   *
   * On the LAN the tail is the store's SSE stream, read with `fetch` so the
   * key travels in the `X-ADOS-Key` header, never in the URL. The relay
   * carries unary request/response only, so a relayed tail polls the query
   * surface instead (see {@link pollTail}). Throws when no host is
   * resolvable (so the caller can fall back). */
  tail(params: TailParams, handlers: LogTailHandlers): LogTail {
    if (this.ctx.relay) return this.pollTail(params, handlers);
    const { origin, prefix } = tierBase(this.ctx, "proxy");
    const qs = new URLSearchParams(buildQueryString({ ...params, kind: "logs" }));
    if (params.replay != null) qs.set("replay", String(params.replay));
    const url = `${origin}${prefix}/tail?${qs.toString()}`;
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (this.ctx.apiKey) headers["X-ADOS-Key"] = this.ctx.apiKey;
    return openLogTail(
      url,
      headers,
      this.ctx.defaultTimeoutMs ?? AGENT_FETCH_TIMEOUT_MS,
      handlers,
    );
  }

  /** The relayed live tail: polls the query surface (see
   * {@link pollRelayTail}). */
  private pollTail(params: TailParams, handlers: LogTailHandlers): LogTail {
    return pollRelayTail((p) => this.query<LoggingRow>(p), params, handlers);
  }


  // ── aggregate ──────────────────────────────────────────────────────────

  /** Downsampled metric series for charts. */
  async aggregate(
    params: AggregateParams,
  ): Promise<LoggingEnvelope<AggregatePoint>> {
    const qs = new URLSearchParams();
    appendList(qs, "metric", params.metric);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.session) qs.set("session", params.session);
    if (params.bucket) qs.set("bucket", params.bucket);
    if (params.agg) qs.set("agg", params.agg);
    appendList(qs, "group_by", params.group_by);
    // Legacy has no equivalent, so a legacy answer (flat array) yields an
    // empty series rather than throwing.
    const { body, tier } = await resolveTier(this.ctx, "/aggregate", qs.toString());
    if (tier === "legacy") {
      return emptyLegacyEnvelope<AggregatePoint>();
    }
    return asEnvelope(body, TIER_SOURCE[tier], normaliseBucket);
  }

  // ── sessions ───────────────────────────────────────────────────────────

  /** The boot / flight / manual session list. Legacy has no sessions, so
   * a store-less agent yields an empty list (the session picker then shows
   * "no sessions" rather than failing). */
  async sessions(
    params: SessionListParams = {},
  ): Promise<LoggingEnvelope<SessionRow>> {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.kind) qs.set("kind", params.kind);
    if (params.open != null) qs.set("open", String(params.open));
    if (params.limit != null) qs.set("limit", String(params.limit));
    if (params.cursor) qs.set("cursor", params.cursor);
    const { body, tier } = await resolveTier(this.ctx, "/sessions", qs.toString());
    if (tier === "legacy") {
      return emptyLegacyEnvelope<SessionRow>();
    }
    return asEnvelope(body, TIER_SOURCE[tier], normaliseSessionRow);
  }

  // ── export ───────────────────────────────────────────────────────────

  async export(params: ExportParams = {}): Promise<{
    stream: ReadableStream<Uint8Array>;
    format: ExportFormat;
    source: LoggingSource;
  }> {
    return exportWindow(this.ctx, params);
  }

  // ── push ───────────────────────────────────────────────────────────────

  /** Export a chosen window from the durable store to the paired cloud
   * account (see {@link pushWindow}). */
  async pushWindow(params: PushParams = {}): Promise<PushResult> {
    return pushWindow(this.ctx, params);
  }


  // ── stats / healthz ────────────────────────────────────────────────────

  /** DB + ingest + sync health. Drives the health/sync badge. Legacy has
   * no stats; a store-less agent throws (the badge then renders "unknown"). */
  async stats(): Promise<StatsResponse> {
    const { body, tier } = await resolveTier(this.ctx, "/stats", "");
    if (tier === "legacy") {
      throw new Error("stats unavailable on legacy agent");
    }
    return { ...normaliseStats(body), source: TIER_SOURCE[tier] };
  }

  /** Liveness/readiness probe. Returns `{ ok:false }` rather than throwing
   * when no tier answers, so a reachability check is a single await. */
  async healthz(): Promise<HealthzResponse> {
    try {
      const { body, tier } = await resolveTier(this.ctx, "/healthz", "");
      if (tier === "legacy") {
        // A live legacy `/api/logs` answer means the agent is up, but there
        // is no durable store behind it.
        return {
          ok: true,
          db_open: false,
          writer_alive: false,
          integrity: false,
          source: "legacy",
        };
      }
      return { ...normaliseHealth(body), source: TIER_SOURCE[tier] };
    } catch {
      return {
        ok: false,
        db_open: false,
        writer_alive: false,
        integrity: false,
        source: "logd",
      };
    }
  }
}
