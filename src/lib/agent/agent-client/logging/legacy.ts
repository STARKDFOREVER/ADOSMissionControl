/**
 * @module agent/agent-client/logging
 * @description Legacy `/api/logs` normalisation and envelope coercion.
 * @license GPL-3.0-only
 */

import { toLogLevel, usToIso } from "../logging-wire";
import type { LoggingRow, LoggingSource, LoggingEnvelope } from "./types";

// ── Legacy normalisation ──────────────────────────────────────────────

/** Coerce one legacy `/api/logs` entry to a `LoggingRow`. The legacy
 * surface emits `{ timestamp, level, logger|service, msg|message }`. */
export function normaliseLegacyRow(raw: unknown, idx: number): LoggingRow {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ts =
    typeof r.timestamp === "string"
      ? r.timestamp
      : typeof r.ts === "string"
        ? r.ts
        : new Date().toISOString();
  const tsMs = Date.parse(ts);
  const level = toLogLevel(r.level);
  return {
    ts,
    ts_us: Number.isFinite(tsMs) ? tsMs * 1000 : 0,
    // Legacy rows have no stable id; synthesise a deterministic-enough one
    // from the timestamp + position so React keys stay stable within a page.
    id: typeof r.id === "string" ? r.id : `legacy-${tsMs || 0}-${idx}`,
    level,
    message: String(r.message ?? r.msg ?? ""),
    source: String(r.source ?? r.service ?? r.logger ?? "agent"),
  };
}

export function wrapLegacy(rows: unknown[]): LoggingEnvelope<LoggingRow> {
  const data = rows.map((r, i) => normaliseLegacyRow(r, i));
  return {
    data,
    page: { next_cursor: null, count: data.length },
    meta: {
      source: "legacy",
      v: 1,
      ts: new Date().toISOString(),
      db_lag_ms: 0,
    },
  };
}

/** The empty result a read surface returns when the tier that answered (the
 * legacy `/api/logs` shape) cannot carry it at all. Several surfaces must
 * agree on this shape, so it is built in one place. */
export function emptyLegacyEnvelope<T>(): LoggingEnvelope<T> {
  return {
    data: [],
    page: { next_cursor: null, count: 0 },
    meta: {
      source: "legacy",
      v: 1,
      ts: new Date().toISOString(),
      db_lag_ms: 0,
    },
  };
}

/** Coerce a raw `/v1` JSON body into the typed envelope, mapping each wire
 * row through `mapRow` and tolerating extra fields the agent ships ahead of
 * the client. */
export function asEnvelope<T>(
  body: unknown,
  source: LoggingSource,
  mapRow: (raw: unknown, idx: number) => T,
): LoggingEnvelope<T> {
  const b = (body ?? {}) as Record<string, unknown>;
  const data = Array.isArray(b.data) ? b.data.map(mapRow) : [];
  const page = (b.page ?? {}) as Record<string, unknown>;
  const meta = (b.meta ?? {}) as Record<string, unknown>;
  return {
    data,
    page: {
      next_cursor:
        typeof page.next_cursor === "string" ? page.next_cursor : null,
      count: typeof page.count === "number" ? page.count : data.length,
    },
    meta: {
      // Trust the server's own `source` when present; else attribute to the
      // tier that answered.
      source:
        meta.source === "logd" || meta.source === "proxy" || meta.source === "legacy"
          ? (meta.source as LoggingSource)
          : source,
      v: typeof meta.v === "number" ? meta.v : 1,
      // The store stamps the server time as a microsecond epoch.
      ts:
        typeof meta.ts === "number"
          ? usToIso(meta.ts)
          : typeof meta.ts === "string"
            ? meta.ts
            : new Date().toISOString(),
      db_lag_ms: typeof meta.db_lag_ms === "number" ? meta.db_lag_ms : 0,
    },
  };
}
