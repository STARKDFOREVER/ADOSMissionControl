/**
 * Telemetry recording system.
 *
 * Captures telemetry frames per drone with timestamps to IndexedDB for
 * later replay, export, and analysis. Recordings persist across sessions.
 *
 * Frames are stored in chunks of {@link RECORDING_CHUNK_FRAMES}: a live
 * recording writes each chunk as it fills, so a long flight never holds all
 * of its frames in memory and a storage failure loses at most the chunk being
 * written. When a write fails the recording stops capturing, keeps what was
 * stored, and is marked with `truncatedAtMs`.
 *
 * @module telemetry-recorder
 * @license GPL-3.0-only
 */

export type { TelemetryFrame, RecordingMarker, TelemetryRecording } from "./types";
export { RECORDING_CHUNK_FRAMES, MAX_UNREFERENCED_LIVE_RECORDINGS } from "./types";
export {
  onRecordingStorageFailure,
  reportRecordingStorageFailure,
  saveFlightRecording,
  setRecordingFromFrames,
  listRecordings,
  loadRecordingFrames,
  deleteRecording,
} from "./storage";
export {
  startRecordingFor,
  recordFrameFor,
  startMirrorRecording,
  markRecording,
  stopRecordingFor,
  isRecordingFor,
  activeRecordingFor,
  recordingFramesBetween,
} from "./recorder";
