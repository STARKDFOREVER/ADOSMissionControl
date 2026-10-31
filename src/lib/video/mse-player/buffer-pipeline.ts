import {
  LIVE_EDGE_MARGIN_S,
  MAX_LIVE_DRIFT_S,
  MAX_QUEUED_SEGMENTS,
  RETAINED_BEHIND_S,
} from "./constants";
import { codecStringFromInitSegment, mseTypeFor } from "../fmp4-codec";
import type { MsePlayerErrorCode } from "./types";

/** What the buffer pipeline needs from the player session that owns it. */
export interface MseBufferHost {
  video(): HTMLVideoElement | null;
  fail(code: MsePlayerErrorCode, message: string): void;
  scheduleReconnect(): void;
  /** A live-edge seek moved the playhead; reset the stall baseline. */
  onLiveEdgeSeek(currentTime: number): void;
}

/**
 * The source buffer and its bounded append queue: ordering, overflow drops,
 * trimming behind the playhead and the live-edge seek.
 */
export class MseBufferPipeline {
  private sourceBuffer: SourceBuffer | null = null;
  private queue: ArrayBuffer[] = [];
  /** Segments dropped to hold the queue bound, for the reconnect decision. */
  private droppedSegments = 0;
  /**
   * Set when a queued segment was dropped. The next `updateend` then seeks to
   * the live edge regardless of the drift threshold, because a drop is a
   * known discontinuity in the timeline.
   */
  private liveEdgeSeekPending = false;

  constructor(private readonly host: MseBufferHost) {}

  /** True once the init segment created a source buffer for this session. */
  get hasSourceBuffer(): boolean {
    return this.sourceBuffer !== null;
  }

  /** Start of a session: clear the drop accounting. */
  resetCounters(): void {
    this.droppedSegments = 0;
    this.liveEdgeSeekPending = false;
  }

  /** Teardown: forget the source buffer and every queued segment. */
  detach(): void {
    this.sourceBuffer = null;
    this.queue = [];
  }

  /**
   * Create the source buffer for the codec the init segment declares.
   * Returns false when the session cannot proceed; the reason has already
   * been reported through {@link fail}.
   */
  open(mediaSource: MediaSource, initSegment: ArrayBuffer): boolean {
    const codec = codecStringFromInitSegment(initSegment);
    if (!codec) {
      this.host.fail(
        "codec-unknown",
        "the stream's first segment carries no codec configuration this player can read",
      );
      return false;
    }
    const mimeType = mseTypeFor(codec);
    if (
      typeof MediaSource.isTypeSupported === "function" &&
      !MediaSource.isTypeSupported(mimeType)
    ) {
      this.host.fail(
        "codec-unsupported",
        `this browser cannot decode ${mimeType}`,
      );
      return false;
    }
    try {
      this.sourceBuffer = mediaSource.addSourceBuffer(mimeType);
    } catch (err) {
      this.host.fail(
        "source-buffer-rejected",
        `addSourceBuffer(${mimeType}) was refused: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
    this.sourceBuffer.addEventListener("updateend", () => {
      // Reclaim before appending more. `remove()` is only legal while the
      // buffer is idle, which is exactly here — calling it right after an
      // append (as this used to) hit the `updating` guard every time, so
      // the trim never ran on a live stream and the buffer grew until the
      // browser raised QuotaExceededError and the feed froze.
      //
      // A removal raises its own `updateend`, which re-enters this handler
      // and does the flush then; returning here keeps the two operations
      // from racing for the buffer.
      if (this.trimBehindPlayhead()) return;
      this.flushQueue();
      const forced = this.liveEdgeSeekPending;
      this.liveEdgeSeekPending = false;
      this.seekToLiveEdgeIfDrifted(forced);
    });
    // A sourceBuffer error or abort wedges the decode graph; neither
    // is recoverable by appending more data. Reconnect from scratch.
    this.sourceBuffer.addEventListener("error", () => {
      this.host.scheduleReconnect();
    });
    this.sourceBuffer.addEventListener("abort", () => {
      this.host.scheduleReconnect();
    });
    return true;
  }

  /**
   * Append now, or queue behind the in-flight append.
   *
   * The queue is bounded and drops the OLDEST segment on overflow: this is a
   * live feed, so the newest bytes are the ones worth keeping, and an
   * unbounded queue turns a slow decoder into unbounded memory growth. A
   * drop is a discontinuity, so it also arms the live-edge seek — otherwise
   * playback sits behind the gap for the rest of the session.
   */
  push(data: ArrayBuffer): void {
    const buffer = this.sourceBuffer;
    if (!buffer) return;
    // Append directly only when nothing is waiting: a segment that skipped
    // the queue would land ahead of older bytes and corrupt the timeline.
    if (!buffer.updating && this.queue.length === 0) {
      try {
        buffer.appendBuffer(data);
        return;
      } catch {
        // Fall through to the queue: a QuotaExceededError here means the
        // buffer is full and the trim has not run yet.
      }
    }
    this.queue.push(data);
    while (this.queue.length > MAX_QUEUED_SEGMENTS) {
      this.queue.shift();
      this.droppedSegments += 1;
      this.liveEdgeSeekPending = true;
    }
    this.flushQueue();
  }

  /**
   * Trim everything more than {@link RETAINED_BEHIND_S} behind the playhead.
   *
   * Returns true when a removal was started, in which case the buffer is
   * busy and the caller must wait for the next `updateend`.
   *
   * The old rule only trimmed once `currentTime > 10`, which never fires on
   * a stream that never advances — precisely the wedged case where the
   * buffer most needs reclaiming.
   */
  trimBehindPlayhead(): boolean {
    const buffer = this.sourceBuffer;
    const video = this.host.video();
    if (!buffer || !video || buffer.updating) return false;
    const cutoff = video.currentTime - RETAINED_BEHIND_S;
    if (cutoff <= 0) return false;
    try {
      if (buffer.buffered.length > 0 && buffer.buffered.start(0) < cutoff) {
        buffer.remove(0, cutoff);
        return true;
      }
    } catch {
      // A remove can still be refused mid-teardown; the next updateend retries.
    }
    return false;
  }

  /**
   * Pull the playhead up to the buffer's leading edge when it has fallen
   * behind.
   *
   * MSE plays from wherever `currentTime` is and nothing pulls it forward,
   * so after a stall, a dropped segment, or a backgrounded tab the operator
   * watches a delayed feed with no sign that it is delayed — which on a
   * piloting surface is the whole problem.
   */
  private seekToLiveEdgeIfDrifted(force = false): void {
    const buffer = this.sourceBuffer;
    const video = this.host.video();
    if (!buffer || !video) return;
    try {
      const ranges = buffer.buffered;
      if (ranges.length === 0) return;
      const edge = ranges.end(ranges.length - 1);
      if (!force && edge - video.currentTime <= MAX_LIVE_DRIFT_S) return;
      video.currentTime = Math.max(edge - LIVE_EDGE_MARGIN_S, 0);
      this.host.onLiveEdgeSeek(video.currentTime);
    } catch { /* ignore */ }
  }

  flushQueue(): void {
    const buffer = this.sourceBuffer;
    if (!buffer || buffer.updating || this.queue.length === 0) return;
    const next = this.queue.shift();
    if (!next) return;
    try {
      buffer.appendBuffer(next);
    } catch {
      // Usually QuotaExceededError: put the segment back and reclaim. The
      // trim's `updateend` retries the append. When no trim can start, the
      // segment cannot ever fit, so it is dropped and counted.
      this.queue.unshift(next);
      if (!this.trimBehindPlayhead()) {
        this.queue.shift();
        this.droppedSegments += 1;
        this.liveEdgeSeekPending = true;
      }
    }
  }
}
