// ── Types ────────────────────────────────────────────────────

export interface TelemetryFrame {
  /** Milliseconds since recording start. */
  offsetMs: number;
  /** Channel name (attitude, position, battery, etc.). */
  channel: string;
  /** The telemetry data object. */
  data: unknown;
}

/**
 * An operator- or plugin-placed annotation on a recording timeline. Marks a
 * moment of interest (an event, a manual flag) at a fixed offset from the
 * recording start so Charts/Replay can pin it later.
 */
export interface RecordingMarker {
  /** Milliseconds since recording start. */
  offsetMs: number;
  /** Short human-readable label. */
  label: string;
  /** Optional structured payload carried with the marker. */
  data?: Record<string, unknown>;
}

export interface TelemetryRecording {
  id: string;
  /** Human-readable name. */
  name: string;
  /** Recording start timestamp (ms since epoch). */
  startTime: number;
  /** Recording end timestamp (ms since epoch). */
  endTime: number;
  /** Duration in ms. */
  durationMs: number;
  /** Total frame count. */
  frameCount: number;
  /** Channels captured. */
  channels: string[];
  /** Drone ID, if known. */
  droneId?: string;
  /** Drone name, if known. */
  droneName?: string;
  /** Timeline markers, if any were placed during the recording. */
  markers?: RecordingMarker[];
  /**
   * True for a recording brought in from a log file. Imports are kept until
   * the operator deletes them.
   */
  imported?: boolean;
  /**
   * Number of IndexedDB values the frames are split across. Absent means
   * one (a recording stored before chunking).
   */
  chunkCount?: number;
  /**
   * Set when storage failed during the recording: capture stopped at this
   * offset (ms from the recording start) and nothing after it was kept.
   */
  truncatedAtMs?: number;
}

/** A slot is recording while it is in {@link _slots}; finalizing removes it first. */
export interface RecorderSlot {
  startTime: number;
  /** Frames not yet handed to IndexedDB. */
  frames: TelemetryFrame[];
  channels: Set<string>;
  recordingId: string;
  droneId?: string;
  droneName?: string;
  /** Timeline markers placed during the recording. */
  markers: RecordingMarker[];
  /** Last write timestamp per channel for rate limiting (ms since epoch). */
  lastWriteAt: Map<string, number>;
  /** Chunks handed to IndexedDB (written or queued). */
  chunkCount: number;
  /** Frames whose chunk write completed. */
  storedFrames: number;
  /** The chain of chunk writes, in order; finalize and reads wait on it. */
  flushing: Promise<void>;
  /** Offset capture stopped at after a chunk write failed. */
  truncatedAtMs?: number;
}
/** Frames per stored chunk. */
export const RECORDING_CHUNK_FRAMES = 50_000;

/**
 * Live recordings no flight record uses (manual, record-on-connect and plugin
 * recordings) kept in the index; the oldest beyond this are deleted. A
 * recording a flight in history uses is never deleted to make room.
 */
export const MAX_UNREFERENCED_LIVE_RECORDINGS = 20;
