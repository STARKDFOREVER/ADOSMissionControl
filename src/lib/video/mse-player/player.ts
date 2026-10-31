import { MseBufferPipeline } from "./buffer-pipeline";
import {
  CONNECT_DEADLINE_MS,
  PLAYBACK_STALL_TIMEOUT_MS,
  RECONNECT_DELAY_MS,
  SILENT_PRE_OPEN_RETRIES,
  STALL_CHECK_INTERVAL_MS,
  VIDEO_RELAY_URL_DEFAULT,
  type TimerHandle,
} from "./constants";
import type { MsePlayerError, MsePlayerErrorCode, MsePlayerOptions } from "./types";

export class MsePlayer {
  private ws: WebSocket | null = null;
  private mediaSource: MediaSource | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private deviceId: string = "";
  private videoRelayUrl: string = VIDEO_RELAY_URL_DEFAULT;
  private reconnectTimer: TimerHandle | null = null;
  /** Armed for each dial; cleared by `open`. See {@link CONNECT_DEADLINE_MS}. */
  private connectDeadline: TimerHandle | null = null;
  private onError: ((err: MsePlayerError) => void) | null = null;
  /**
   * The options this session was started with, retained so `reconnect()` can
   * re-pass them. `reconnect()` used to call `start()` with three arguments,
   * which dropped the caller's `onError` on the first reconnect — so a relay
   * that failed after one successful minute went silent again.
   */
  private options: MsePlayerOptions | undefined;

  // Playback-stall watchdog. Tracks currentTime advancement so a frozen
  // decoder (no socket close, no error event) still triggers a reconnect.
  private stallTimer: TimerHandle | null = null;
  private lastPlaybackTime = 0;
  private lastPlaybackAdvanceAt = 0;
  // Guards against overlapping reconnect attempts from multiple triggers
  // (ws close + sourceBuffer error + stall watchdog all firing at once).
  private reconnectScheduled = false;
  // Set while stop() is tearing the session down. A socket closed as part
  // of an intentional teardown must NOT schedule a reconnect, so every
  // reconnect trigger bails when this is set. Cleared by the next start().
  private tearingDown = false;
  /**
   * Sockets in a row that closed (or timed out) before opening, across
   * reconnects. Reset by a successful open and by a caller's `start()`,
   * never by `reconnect()`, so a relay that keeps refusing is reported.
   */
  private preOpenFailures = 0;
  /**
   * Bumped by every `stop()`, so a token fetch that resolves after its
   * session was torn down or replaced does not open a socket for it.
   */
  private sessionSeq = 0;
  private readonly pipeline = new MseBufferPipeline({
    video: () => this.videoElement,
    fail: (code, message) => this.fail(code, message),
    scheduleReconnect: () => this.scheduleReconnect(),
    onLiveEdgeSeek: (currentTime) => {
      this.lastPlaybackTime = currentTime;
      this.lastPlaybackAdvanceAt = Date.now();
    },
  });

  start(
    deviceId: string,
    videoElement: HTMLVideoElement,
    videoRelayUrl?: string,
    options?: MsePlayerOptions,
  ): void {
    this.preOpenFailures = 0;
    this.beginSession(deviceId, videoElement, videoRelayUrl, options);
  }

  private beginSession(
    deviceId: string,
    videoElement: HTMLVideoElement,
    videoRelayUrl?: string,
    options?: MsePlayerOptions,
  ): void {
    this.stop();
    // A fresh session — clear the teardown latch that stop() set.
    this.tearingDown = false;
    this.deviceId = deviceId;
    this.videoElement = videoElement;
    this.pipeline.resetCounters();
    if (videoRelayUrl) this.videoRelayUrl = videoRelayUrl;
    if (options !== undefined) this.options = options;
    if (this.options?.onError !== undefined) this.onError = this.options.onError;

    if (!("MediaSource" in window)) {
      this.fail("mse-unsupported", "MediaSource is not available in this browser");
      return;
    }

    this.mediaSource = new MediaSource();
    videoElement.src = URL.createObjectURL(this.mediaSource);

    this.mediaSource.addEventListener("sourceopen", () => {
      this.connectWebSocket();
    });

    this.startStallWatchdog();
  }

  /**
   * Poll currentTime while the socket is open. If playback has not
   * advanced within the timeout, the decoder has stalled silently (the
   * relay can keep the socket open and keep sending bytes that the
   * decoder refuses) — reconnect from scratch instead of waiting for an
   * onclose that never comes.
   */
  private startStallWatchdog(): void {
    if (this.stallTimer) return;
    this.lastPlaybackAdvanceAt = Date.now();
    this.lastPlaybackTime = this.videoElement?.currentTime ?? 0;
    this.stallTimer = setInterval(() => {
      const video = this.videoElement;
      // Only judge a stall while the socket is open. A closed socket has
      // its own reconnect path; a paused/backgrounded tab should not be
      // treated as a failure.
      if (!video || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.lastPlaybackAdvanceAt = Date.now();
        return;
      }
      if (video.paused) {
        this.lastPlaybackAdvanceAt = Date.now();
        return;
      }
      const now = Date.now();
      if (video.currentTime > this.lastPlaybackTime) {
        this.lastPlaybackTime = video.currentTime;
        this.lastPlaybackAdvanceAt = now;
        return;
      }
      if (now - this.lastPlaybackAdvanceAt > PLAYBACK_STALL_TIMEOUT_MS) {
        this.scheduleReconnect();
      }
    }, STALL_CHECK_INTERVAL_MS);
  }

  /**
   * Report a session failure to the caller. Every call site except
   * `mse-unsupported` then schedules a reconnect, so the report says why
   * frames are not flowing right now, not that the session has ended.
   *
   * Every one of these sites used to be a bare `return`. That is how the
   * hardcoded codec became a silent black screen rather than a message.
   */
  private fail(code: MsePlayerErrorCode, message: string): void {
    console.warn(`[mse-player] ${code}: ${message}`);
    this.onError?.({ code, message });
  }

  /**
   * The local recording surface used to live here — a second
   * `MediaRecorder` over `videoElement.captureStream()`, with its own
   * chunk array and its own download. It had no caller: the only
   * invocation left was `stop()` calling its own `stopRecording()`.
   * `video/webrtc/recording` is the one local-capture path.
   */

  stop(): void {
    // Latch teardown so the imminent socket close does not bounce back
    // through scheduleReconnect(). reconnect() re-issues the session, which
    // clears the latch for the new one.
    this.tearingDown = true;
    this.sessionSeq += 1;
    if (this.stallTimer) {
      clearInterval(this.stallTimer);
      this.stallTimer = null;
    }
    this.reconnectScheduled = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearConnectDeadline();
    this.dropSocket();
    if (this.mediaSource && this.mediaSource.readyState === "open") {
      try {
        this.mediaSource.endOfStream();
      } catch { /* ignore */ }
    }
    this.mediaSource = null;
    this.pipeline.detach();
    if (this.videoElement) {
      if (this.videoElement.src) {
        URL.revokeObjectURL(this.videoElement.src);
      }
      this.videoElement.src = "";
      this.videoElement = null;
    }
  }

  /**
   * Detach every handler BEFORE close() so the close event of a socket the
   * player chose to drop does not fire scheduleReconnect() a second time.
   */
  private dropSocket(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.onopen = null;
    ws.close();
  }

  private clearConnectDeadline(): void {
    if (this.connectDeadline) {
      clearTimeout(this.connectDeadline);
      this.connectDeadline = null;
    }
  }

  /**
   * Count a dial that ended before its socket opened, and report it once
   * the silent allowance is used up. The caller schedules the retry.
   */
  private notePreOpenFailure(message: string): void {
    this.preOpenFailures += 1;
    if (this.preOpenFailures > SILENT_PRE_OPEN_RETRIES) {
      this.fail("relay-refused", message);
    }
  }

  /** Fetch a fresh viewer token when the caller supplies a source, then dial. */
  private connectWebSocket(): void {
    this.clearConnectDeadline();
    this.connectDeadline = setTimeout(() => {
      this.connectDeadline = null;
      this.dropSocket();
      this.notePreOpenFailure(
        `the video relay did not open a connection within ${CONNECT_DEADLINE_MS / 1000} s`,
      );
      this.scheduleReconnect();
    }, CONNECT_DEADLINE_MS);

    const getRelayToken = this.options?.getRelayToken;
    if (!getRelayToken) {
      this.openSocket(null);
      return;
    }
    // `stop()` bumps the sequence, so a token that lands after its session
    // was torn down or replaced is dropped; so is one that lands after the
    // connect deadline already gave up on this dial.
    const seq = this.sessionSeq;
    getRelayToken().then(
      (token) => {
        if (seq === this.sessionSeq && !this.reconnectScheduled) this.openSocket(token);
      },
      (err: unknown) => {
        if (seq !== this.sessionSeq || this.reconnectScheduled) return;
        this.clearConnectDeadline();
        this.fail(
          "relay-token-unavailable",
          err instanceof Error ? err.message : String(err),
        );
        this.scheduleReconnect();
      },
    );
  }

  private openSocket(token: string | null): void {
    const url = token
      ? `${this.videoRelayUrl}/ws/stream/${this.deviceId}?token=${encodeURIComponent(token)}`
      : `${this.videoRelayUrl}/ws/stream/${this.deviceId}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.clearConnectDeadline();
      this.preOpenFailures = 0;
      // Fresh connection — reset the stall baseline and clear the
      // reconnect guard so a later failure can schedule again.
      this.reconnectScheduled = false;
      this.lastPlaybackAdvanceAt = Date.now();
      this.lastPlaybackTime = this.videoElement?.currentTime ?? 0;
    };

    ws.onmessage = (event) => {
      const data = event.data as ArrayBuffer;
      this.appendBuffer(data);
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (!opened) {
        this.clearConnectDeadline();
        this.notePreOpenFailure(
          "the video relay closed the connection before it opened: the viewer token was refused or the relay is unreachable",
        );
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  /**
   * Debounced reconnect. Multiple triggers (socket close, sourceBuffer
   * error/abort, playback stall) can fire near-simultaneously; the guard
   * collapses them into a single fresh connection attempt.
   */
  private scheduleReconnect(): void {
    if (this.tearingDown || this.reconnectScheduled || !this.deviceId) return;
    this.reconnectScheduled = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnect();
    }, RECONNECT_DELAY_MS);
  }

  /**
   * Tear the transport + MSE graph down and rebuild it. A frozen decoder
   * or an aborted sourceBuffer cannot be recovered in place, so we
   * recreate the MediaSource and re-open the socket from scratch.
   */
  private reconnect(): void {
    const video = this.videoElement;
    const deviceId = this.deviceId;
    const relayUrl = this.videoRelayUrl;
    const options = this.options;
    if (!video || !deviceId) return;
    // stop() clears timers + tracks + nulls videoElement; rebuild the
    // pipeline with the captured references. The options go back in too:
    // without them the caller's error handler survived exactly one session.
    // `beginSession`, not `start`, so the run of pre-open failures carries
    // over and a relay that keeps refusing stays reported while it retries.
    this.stop();
    this.beginSession(deviceId, video, relayUrl, options);
  }

  private appendBuffer(data: ArrayBuffer): void {
    if (!this.mediaSource || this.mediaSource.readyState !== "open") return;

    // The first message is the fMP4 init segment, which is where the codec
    // comes from. Passing a hardcoded string here was the silent-black-screen
    // bug: the source buffer is created against a codec the bytes are not,
    // every subsequent append is refused, and nothing says so.
    // A failure here is reported, then the session is rebuilt on the fixed
    // cadence (the stream's codec can change when the drone's pipeline is
    // reconfigured). Later segments of the doomed session are ignored.
    if (this.reconnectScheduled) return;
    if (!this.pipeline.hasSourceBuffer && !this.pipeline.open(this.mediaSource, data)) {
      this.scheduleReconnect();
      return;
    }

    // NOT followed by a trim: `enqueue` has just called `appendBuffer`, so
    // `updating` is true and `remove()` would throw. The trim runs from
    // `updateend`, the only moment it is legal.
    this.pipeline.push(data);
  }

}
