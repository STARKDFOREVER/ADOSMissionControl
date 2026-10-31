import { OFFICIAL_VIDEO_RELAY_URL } from "@/lib/config/endpoints";

/**
 * Cross-environment timer handle: `number` under the DOM lib, `Timeout`
 * under Node's, and this module is type-checked against both.
 */
export type TimerHandle = ReturnType<typeof setTimeout>;

export const VIDEO_RELAY_URL_DEFAULT = OFFICIAL_VIDEO_RELAY_URL;

// Fixed delay before every reconnect: after a transport drop, a detected
// stall, a refused or failed token mint, or a session failure. The session
// never gives up on its own; only `stop()` ends it.
export const RECONNECT_DELAY_MS = 3000;
/**
 * A dial (token mint plus WebSocket handshake) that has not opened within
 * this long is abandoned and retried. A socket hung in CONNECTING raises no
 * close and the stall watchdog only judges an open socket, so without this
 * deadline the tile would wait on it indefinitely.
 */
export const CONNECT_DEADLINE_MS = 5000;
/**
 * Consecutive sockets that closed before opening which are retried silently.
 * The relay answers a refused token with a bare HTTP 401 on the upgrade,
 * which a browser surfaces only as a close before `open`. The first such
 * close is usually an expired token and the next dial mints a fresh one;
 * from the second in a row on, the refusal is reported while retrying
 * continues on the same fixed cadence.
 */
export const SILENT_PRE_OPEN_RETRIES = 1;
// How often the playback-stall watchdog samples currentTime.
export const STALL_CHECK_INTERVAL_MS = 1000;
// currentTime frozen for at least this long while the socket is open
// means the decoder has wedged; force a fresh connection.
export const PLAYBACK_STALL_TIMEOUT_MS = 5000;

/**
 * Segments allowed to pile up while the source buffer is busy.
 *
 * The queue was unbounded. A source buffer that cannot keep up — a stalled
 * decoder, a backgrounded tab, a relay burst — grew it for as long as the
 * socket stayed open, so the failure mode of a slow decoder was memory
 * growth with no ceiling. Twelve segments is a couple of seconds of media at
 * the relay's segment cadence: enough to ride out a hiccup, not enough to be
 * a leak.
 */
export const MAX_QUEUED_SEGMENTS = 12;

/** Media kept behind `currentTime`, for a scrub back and for decode context. */
export const RETAINED_BEHIND_S = 5;

/**
 * Drift from the live edge that triggers a seek, and where to land.
 *
 * 0.6 s / 0.15 s, not 2 s / 0.3 s. This is a piloting feed: allowing two
 * seconds of drift before chasing, then landing 300 ms behind the edge, is up
 * to 2.3 s of delay the operator has no indication of. The tighter pair still
 * leaves ~5 frames of decode headroom at 30 fps.
 */
export const MAX_LIVE_DRIFT_S = 0.6;
/** Where to land relative to the leading edge, leaving decode headroom. */
export const LIVE_EDGE_MARGIN_S = 0.15;
