/**
 * @module agent/agent-client/logging
 * @description Relayed live tail that polls the query surface.
 * @license GPL-3.0-only
 */

import type { LogTail, LogTailHandlers } from "../log-tail";
import type { LoggingRow, QueryParams, TailParams, LoggingEnvelope } from "./types";
import { RELAY_TAIL_POLL_MS, RELAY_PAGE_ROWS, RELAY_TAIL_MAX_PAGES } from "./tiers";

/**
 * The relayed live tail: poll the query every {@link RELAY_TAIL_POLL_MS}
 * with a time cursor (the newest delivered `ts_us`, inclusive on the
 * store, plus the rows already delivered at exactly that stamp so none
 * repeats). The first poll delivers the newest `replay` rows; each later
 * poll pages back from the newest row to the cursor and delivers what is
 * new, oldest first. Polls never overlap. A failed poll ends the tail
 * through `onError`, like a dropped stream.
 */
export function pollRelayTail(
  query: (params: QueryParams) => Promise<LoggingEnvelope<LoggingRow>>,
  params: TailParams,
  handlers: LogTailHandlers,
): LogTail {
  const replay = params.replay ?? 0;
  // The tail owns the time bound and the paging cursor.
  const filters: QueryParams = { ...params, from: undefined, cursor: undefined };
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sinceUs: number | null = null;
  let deliveredAtSince = new Set<string>();
  const rowKey = (row: LoggingRow) => `${row.ts_us}\u0000${row.source}\u0000${row.message}`;
  // The store pages newest first; the legacy route's order is not part of
  // its contract, so every page is put newest first here.
  const newestFirst = (rows: LoggingRow[]) => [...rows].sort((a, b) => b.ts_us - a.ts_us);

  const pollOnce = async (): Promise<LoggingRow[]> => {
    if (sinceUs === null) {
      // First poll: establish the cursor at the newest row and replay.
      const page = await query({
        ...filters,
        kind: "logs",
        limit: Math.min(Math.max(replay, 1), RELAY_PAGE_ROWS),
      });
      const rows = newestFirst(page.data);
      const newestUs = rows.length > 0 ? rows[0].ts_us : 0;
      sinceUs = newestUs;
      deliveredAtSince = new Set(rows.filter((r) => r.ts_us === newestUs).map(rowKey));
      return rows.slice(0, replay);
    }
    const since = sinceUs;
    const fresh: LoggingRow[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < RELAY_TAIL_MAX_PAGES && !closed; pages += 1) {
      const page = await query({
        ...filters,
        kind: "logs",
        from: String(since),
        limit: RELAY_PAGE_ROWS,
        cursor,
      });
      // Rows come newest first; the legacy tier ignores `from`, so the
      // bound is enforced here as well.
      let reachedCursor = false;
      for (const row of newestFirst(page.data)) {
        if (row.ts_us < since) {
          reachedCursor = true;
          break;
        }
        if (row.ts_us === since && deliveredAtSince.has(rowKey(row))) continue;
        fresh.push(row);
      }
      cursor = page.page.next_cursor ?? undefined;
      if (reachedCursor || !cursor || page.data.length === 0) break;
    }
    if (fresh.length > 0) {
      const newestUs = fresh[0].ts_us;
      const atNewest = fresh.filter((r) => r.ts_us === newestUs).map(rowKey);
      if (newestUs === since) {
        for (const key of atNewest) deliveredAtSince.add(key);
      } else {
        sinceUs = newestUs;
        deliveredAtSince = new Set(atNewest);
      }
    }
    return fresh;
  };

  const tick = async () => {
    let rows: LoggingRow[];
    try {
      rows = await pollOnce();
    } catch (err) {
      if (!closed) {
        closed = true;
        handlers.onError(err instanceof Error ? err : new Error(String(err)));
      }
      return;
    }
    if (closed) return;
    // Oldest first, the order a stream would have delivered them in.
    for (let i = rows.length - 1; i >= 0; i -= 1) handlers.onRow(rows[i]);
    timer = setTimeout(() => void tick(), RELAY_TAIL_POLL_MS);
  };
  void tick();

  return {
    close: () => {
      closed = true;
      clearTimeout(timer);
    },
  };
}
