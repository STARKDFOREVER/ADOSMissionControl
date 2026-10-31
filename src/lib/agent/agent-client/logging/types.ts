/**
 * @module agent/agent-client/logging
 * @description Row, request and response shapes of the logging service.
 * @license GPL-3.0-only
 */

// ── Row shapes ────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warning" | "error";

/** A single log row from the durable store (`kind=logs`), normalised from the
 * store's `LogRow` wire shape by `logging-wire.ts`. */
export interface LoggingRow {
  /** ISO-8601 timestamp derived from `ts_us`. */
  ts: string;
  /** Microseconds since the epoch — the keyset sort key. */
  ts_us: number;
  /** Stable per-row id (second half of the keyset key). */
  id: string;
  level: LogLevel;
  message: string;
  /** Producer source (e.g. `ados-video`, `api`). */
  source: string;
  /** Owning session id, when the row was captured inside one. */
  session?: string;
  /** Structured fields attached to the row, redacted at the source. */
  fields?: Record<string, unknown>;
}

/** A downsampled metric sample (`kind=metrics`). */
export interface MetricsRow {
  ts: string;
  ts_us: number;
  metric: string;
  value: number;
  tags?: Record<string, string>;
}

/** A discrete event row (`kind=events`). `data` is the store's `detail` map. */
export interface EventsRow {
  ts: string;
  ts_us: number;
  kind: string;
  data?: Record<string, unknown>;
  /** Emitting component. */
  source?: string;
  severity?: LogLevel;
}

/** A hardware snapshot row (`kind=hw`): the store's open signal map. */
export interface HWRow {
  ts: string;
  ts_us: number;
  signals: Record<string, unknown>;
}

/** A boot / flight / manual session. */
export interface SessionRow {
  id: string;
  /** ISO-8601, derived from the store's `started_us`. */
  started: string;
  /** ISO-8601, or null while the session is still open. */
  ended: string | null;
  kind: "boot" | "flight" | "manual";
  reason?: string;
  meta?: Record<string, unknown>;
  log_count: number;
  event_count: number;
  /** The store's `span_us` in milliseconds; null while the session is open. */
  duration_ms: number | null;
}

/** One bucketed aggregate point. `ts_us` is the bucket start. */
export interface AggregatePoint {
  ts: string;
  ts_us: number;
  metric: string;
  value: number;
  /** Samples folded into the bucket. */
  count?: number;
}

// ── Request param shapes ──────────────────────────────────────────────

export type LoggingKind = "logs" | "events" | "metrics" | "hw";

export interface QueryParams {
  /** ISO-8601 or relative (`-5m`, `-2h`). */
  from?: string;
  to?: string;
  /** Which table to read. Defaults to `logs` on the server. */
  kind?: LoggingKind;
  /** One or more producer sources. */
  source?: string[];
  /** Minimum level (name or ordinal) for `logs` / `events`. */
  level?: string;
  /** One or more dotted metric keys for `kind=metrics`. */
  metric?: string[];
  /** One or more event kinds for `kind=events`. */
  event_kind?: string[];
  /** Substring match on the message / target. */
  text?: string;
  /** Restrict to one session id. */
  session?: string;
  /** Page size (server-capped). */
  limit?: number;
  /** Opaque keyset cursor from a prior `page.next_cursor`. */
  cursor?: string;
}

export type AggregateBucket = "auto" | "1s" | "1m" | "1h";
export type AggregateAgg =
  | "avg"
  | "min"
  | "max"
  | "p50"
  | "p95"
  | "last"
  | "count";

export interface AggregateParams {
  metric: string[];
  from?: string;
  to?: string;
  session?: string;
  bucket?: AggregateBucket;
  agg?: AggregateAgg;
  group_by?: string[];
}

export type ExportFormat = "jsonl" | "jsonl.zst";

export interface ExportParams extends QueryParams {
  format?: ExportFormat;
}

/** Selector for an explicit, operator-triggered cloud export. These are the
 * only fields the agent's push route reads: an empty selector exports every
 * unsynced row of all four kinds. */
export interface PushParams {
  /** Restrict to one store session id (an integer on the wire). */
  session?: string;
  /** Lower time bound: ISO-8601, epoch microseconds, or relative (`-2h`). */
  since?: string;
  /** Tables to export; absent means all four. */
  kinds?: LoggingKind[];
}

/** The agent's answer for one push request. */
export interface PushResult {
  /** The cloud service had not answered inside the agent's poll window. The
   * request is on disk and may still complete; nothing is confirmed yet. */
  pending: boolean;
  /** Cloud record id for the stored window; null while pending. */
  window_id: string | null;
  /** Server-recomputed sha256 of the uploaded bytes, hex; null while pending. */
  sha256: string | null;
  /** Byte size of the uploaded window. */
  bytes: number;
  /** Row count in the window. */
  rows: number;
  /** True when the same content was already stored (no new copy made). */
  deduped: boolean;
  /** True when the on-device rows were marked as exported. */
  synced: boolean;
}

export interface SessionListParams {
  from?: string;
  to?: string;
  kind?: SessionRow["kind"];
  /** Only sessions still open. */
  open?: boolean;
  limit?: number;
  cursor?: string;
}

export interface TailParams extends QueryParams {
  /** On connect, replay the last N matching rows before the live tail. */
  replay?: number;
}

// ── Response shapes ───────────────────────────────────────────────────

/** Which tier answered a request. */
export type LoggingSource = "logd" | "proxy" | "legacy";

export interface LoggingEnvelope<T> {
  data: T[];
  page: {
    next_cursor: string | null;
    count: number;
  };
  meta: {
    source: LoggingSource;
    /** Envelope version. */
    v: number;
    /** Server time, ISO-8601 (with offset). */
    ts: string;
    /** WAL read-lag in milliseconds. */
    db_lag_ms: number;
  };
}

/** Store + ingest + sync health, as the store's `/v1/stats` reports it. */
export interface StatsResponse {
  db: {
    size_bytes: number;
    wal_size_bytes: number;
    row_counts: Record<string, number>;
    /** True only when the integrity check read `ok`. */
    integrity: boolean;
    /** The raw integrity result (`ok`, or the failure text). */
    integrity_detail: string;
    schema_version: number | null;
  };
  ingest: {
    /** Frames accepted since the store daemon started. */
    accepted: number;
    /** Frames dropped under backpressure, per class. */
    dropped: Record<string, number>;
  };
  sync: {
    /** Rows not yet pushed to the cloud, per table. */
    unsynced_rows: Record<string, number>;
  };
  oldest_ts_us: number | null;
  newest_ts_us: number | null;
  /** Which tier answered the stats call (so the UI can show a degraded badge). */
  source: LoggingSource;
}

export interface HealthzResponse {
  ok: boolean;
  db_open: boolean;
  writer_alive: boolean;
  integrity: boolean;
  source: LoggingSource;
}
