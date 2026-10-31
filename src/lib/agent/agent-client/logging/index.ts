/**
 * @module agent/agent-client/logging
 * @description The `LoggingService` domain module. Reads the durable
 * on-device log/telemetry/event/hardware store and surfaces it through a
 * single typed client. Transport resolution is local-first and two-tier:
 *
 *   1. proxy        <agent>/api/v2/observability/v1/...  (primary)
 *   2. legacy       <agent>/api/logs                     (store off / older agents)
 *
 * `<agent>` is `http://<host>:8080` on the LAN, or the ground station's
 * relay-proxy prefix for a relayed drone: both tiers live on the agent's
 * `:8080` front, which is exactly what the relay forwards to.
 *
 * The store's own query port is not a tier: it serves no CORS headers, so a
 * browser (and the desktop app, which keeps web security on) can never read
 * its answers. Every call tries the tiers in natural order and only cascades
 * on a service-unavailable signal (404 / 502 / 503 / network error).
 * Bad-request / auth / rate-limit responses (400 / 401 / 403 / 429) do NOT
 * cascade — they are surfaced as the real error.
 *
 * The relay carries unary request/response only, so over it the live tail
 * is a 2 s poll of the same query and an export pages through the query.
 *
 * Every successful response is normalised to one envelope shape so a
 * caller never has to know which tier answered. The legacy tier (a flat
 * array of `{ timestamp, level, logger, msg }`) is mapped into the same
 * row + envelope shape on the fly, so older agents keep working with no
 * branch at the call site.
 * @license GPL-3.0-only
 */

export type { LogTail, LogTailHandlers } from "../log-tail";
export type * from "./types";
export { LoggingService } from "./service";
