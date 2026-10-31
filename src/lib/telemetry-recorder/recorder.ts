import { set as idbSet } from "idb-keyval";
import {
  chunkKey,
  indexRecording,
  listRecordings,
  readChunks,
  reportRecordingStorageFailure,
} from "./storage";
import {
  RECORDING_CHUNK_FRAMES,
  type RecorderSlot,
  type TelemetryFrame,
  type TelemetryRecording,
} from "./types";

/**
 * Per-channel max sample rate in Hz. Frames received above this rate are
 * silently dropped to keep IndexedDB payloads under control.
 *
 * Channels not listed here use {@link DEFAULT_RATE_HZ}. Channels listed in
 * {@link CAP_BYPASS_CHANNELS} are exempt entirely.
 */
const CHANNEL_RATE_LIMIT_HZ: Record<string, number> = {
  attitude: 50,
  position: 10,
  globalPosition: 10,
  localPosition: 10,
  gps: 5,
  vfr: 10,
  vibration: 20,
  servoOutput: 20,
  rc: 10,
  radio: 5,
  battery: 5,
  sysStatus: 5,
  ekf: 5,
  wind: 2,
  terrain: 2,
  gimbal: 10,
  obstacle: 5,
  scaledImu: 50,
  homePosition: 1,
  powerStatus: 1,
  distanceSensor: 10,
  fenceStatus: 2,
  estimatorStatus: 5,
  cameraTrigger: 20,
  navController: 5,
  debug: 20,
};

const DEFAULT_RATE_HZ = 20;

/** Channels that bypass rate limiting (e.g. high-rate IMU). */
const CAP_BYPASS_CHANNELS = new Set<string>(["imu_highrate"]);

const _slots = new Map<string, RecorderSlot>();
/** Mirror slot keys fed by a drone's frame stream, keyed by drone id. */
const _mirrors = new Map<string, Set<string>>();

function newSlot(droneId?: string, droneName?: string): RecorderSlot {
  return {
    startTime: Date.now(),
    frames: [],
    channels: new Set(),
    recordingId: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    droneId,
    droneName,
    markers: [],
    lastWriteAt: new Map(),
    chunkCount: 0,
    storedFrames: 0,
    flushing: Promise.resolve(),
  };
}

// ── Per-drone API ────────────────────────────────────────────

/**
 * Start a recording for a specific drone slot. Independent from any other
 * drone's slot. Returns the recording id.
 *
 * @throws if a recording is already in progress for this drone.
 */
export function startRecordingFor(droneId: string, droneName?: string): string {
  if (_slots.has(droneId)) {
    throw new Error(`Already recording for drone ${droneId}`);
  }
  const slot = newSlot(droneId, droneName);
  _slots.set(droneId, slot);
  return slot.recordingId;
}

/**
 * Append a telemetry frame to the recording for {@link droneId}.
 * Noop if no recording is active for that drone. Rate-limited per channel
 * (see {@link CHANNEL_RATE_LIMIT_HZ}).
 */
export function recordFrameFor(droneId: string, channel: string, data: unknown): void {
  const slot = _slots.get(droneId);
  if (slot) appendFrame(slot, channel, data);
  const mirrors = _mirrors.get(droneId);
  if (!mirrors) return;
  for (const key of mirrors) {
    const mirror = _slots.get(key);
    if (mirror) appendFrame(mirror, channel, data);
  }
}

function appendFrame(slot: RecorderSlot, channel: string, data: unknown): void {
  if (slot.truncatedAtMs !== undefined) return;

  if (!CAP_BYPASS_CHANNELS.has(channel)) {
    const rateHz = CHANNEL_RATE_LIMIT_HZ[channel] ?? DEFAULT_RATE_HZ;
    const minIntervalMs = 1000 / rateHz;
    const now = Date.now();
    const last = slot.lastWriteAt.get(channel) ?? 0;
    if (now - last < minIntervalMs) return;
    slot.lastWriteAt.set(channel, now);
  }

  slot.channels.add(channel);
  slot.frames.push({
    offsetMs: Date.now() - slot.startTime,
    channel,
    data,
  });
  if (slot.frames.length >= RECORDING_CHUNK_FRAMES) flushChunk(slot);
}

/**
 * Hand the slot's buffered frames to IndexedDB as its next chunk. Writes run
 * in order. A failed write stops the recording at the start of that chunk:
 * later frames are discarded and the operator is told.
 */
function flushChunk(slot: RecorderSlot): void {
  const chunk = slot.frames;
  const index = slot.chunkCount;
  slot.frames = [];
  slot.chunkCount = index + 1;
  slot.flushing = slot.flushing.then(async () => {
    if (slot.truncatedAtMs !== undefined) return;
    try {
      await idbSet(chunkKey(slot.recordingId, index), chunk);
      slot.storedFrames += chunk.length;
    } catch (err) {
      slot.truncatedAtMs = chunk[0]?.offsetMs ?? Date.now() - slot.startTime;
      slot.chunkCount = index;
      slot.frames = [];
      reportRecordingStorageFailure(err);
    }
  });
}

/**
 * Start a recording in its own slot (`slotKey`) that is fed from
 * {@link droneId}'s frame stream, independent of that drone's own slot. Used
 * for recordings a plugin starts: stopping it never touches the drone's
 * flight recording, and the flight recording never stops it. The recording
 * carries {@link droneId} as its drone. Stop it with `stopRecordingFor(slotKey)`.
 *
 * @throws if a recording is already in progress for this slot.
 */
export function startMirrorRecording(slotKey: string, droneId: string, droneName?: string): string {
  if (_slots.has(slotKey)) {
    throw new Error(`Already recording for ${slotKey}`);
  }
  const slot = newSlot(droneId, droneName);
  _slots.set(slotKey, slot);
  const mirrors = _mirrors.get(droneId) ?? new Set<string>();
  mirrors.add(slotKey);
  _mirrors.set(droneId, mirrors);
  return slot.recordingId;
}

/**
 * Place a timeline marker on the active recording for {@link droneId}.
 *
 * Appends a marker at the current offset (`Date.now() - slot.startTime`).
 * Returns true if a recording was active for that drone, false otherwise so
 * a caller can surface "not recording" without throwing.
 */
export function markRecording(
  droneId: string,
  label: string,
  data?: Record<string, unknown>,
): boolean {
  const slot = _slots.get(droneId);
  if (!slot) return false;
  slot.markers.push({
    offsetMs: Date.now() - slot.startTime,
    label,
    ...(data !== undefined ? { data } : {}),
  });
  return true;
}

/**
 * Stop the recording for {@link droneId} and persist it. Returns metadata or
 * null if no active recording.
 */
export async function stopRecordingFor(droneId: string): Promise<TelemetryRecording | null> {
  const slot = _slots.get(droneId);
  if (!slot) return null;
  return await finalizeSlot(droneId, slot);
}

/** True if a recording is active for the given drone. */
export function isRecordingFor(droneId: string): boolean {
  return _slots.has(droneId);
}

/**
 * The recording currently capturing {@link droneId}'s frames, if any.
 * `truncatedAtMs` is set once storage failed and capture stopped.
 */
export function activeRecordingFor(
  droneId: string,
): { recordingId: string; startTime: number; truncatedAtMs?: number } | undefined {
  const slot = _slots.get(droneId);
  return slot
    ? { recordingId: slot.recordingId, startTime: slot.startTime, truncatedAtMs: slot.truncatedAtMs }
    : undefined;
}

/**
 * The frames recording {@link recordingId} captured between two wall-clock
 * times, with offsets rebased to `fromMs`. Reads the live slot while the
 * recording is still running on {@link droneId}, otherwise the stored frames.
 */
export async function recordingFramesBetween(
  droneId: string,
  recordingId: string,
  fromMs: number,
  toMs: number,
): Promise<TelemetryFrame[]> {
  const slot = _slots.get(droneId);
  let startTime: number;
  let frames: TelemetryFrame[];
  if (slot?.recordingId === recordingId) {
    startTime = slot.startTime;
    frames = await liveSlotFrames(slot);
  } else {
    const stored = (await listRecordings()).find((r) => r.id === recordingId);
    if (!stored) return [];
    startTime = stored.startTime;
    frames = await readChunks(recordingId, stored.chunkCount ?? 1);
  }
  const fromOffset = fromMs - startTime;
  const toOffset = toMs - startTime;
  const out: TelemetryFrame[] = [];
  for (const f of frames) {
    if (f.offsetMs < fromOffset || f.offsetMs > toOffset) continue;
    out.push({ offsetMs: f.offsetMs - fromOffset, channel: f.channel, data: f.data });
  }
  return out;
}

/** Every frame a live slot holds: its written chunks, then the buffered tail. */
async function liveSlotFrames(slot: RecorderSlot): Promise<TelemetryFrame[]> {
  // Snapshot synchronously: every chunk below `queued` is on the chain
  // captured here, and `tail` holds the frames after them.
  const tail = slot.frames;
  const queued = slot.chunkCount;
  await slot.flushing;
  const written = await readChunks(slot.recordingId, Math.min(queued, slot.chunkCount));
  if (slot.truncatedAtMs === undefined) return written.concat(tail);
  const cut = slot.truncatedAtMs;
  return written.concat(tail.filter((f) => f.offsetMs < cut));
}

// ── Internal: persist a slot ─────────────────────────────────

async function finalizeSlot(slotKey: string, slot: RecorderSlot): Promise<TelemetryRecording> {
  // Leave the slot map before the first await: the drone is no longer
  // recording, so a re-arm during the IndexedDB writes starts a fresh slot
  // instead of being mistaken for this one.
  _slots.delete(slotKey);
  if (slot.droneId !== undefined) {
    const mirrors = _mirrors.get(slot.droneId);
    mirrors?.delete(slotKey);
    if (mirrors?.size === 0) _mirrors.delete(slot.droneId);
  }

  const endTime = Date.now();
  if (slot.truncatedAtMs === undefined && (slot.frames.length > 0 || slot.chunkCount === 0)) {
    flushChunk(slot);
  }
  await slot.flushing;
  const recording: TelemetryRecording = {
    id: slot.recordingId,
    name: `Recording ${new Date(slot.startTime).toLocaleString()}`,
    startTime: slot.startTime,
    endTime,
    durationMs: endTime - slot.startTime,
    frameCount: slot.storedFrames,
    channels: Array.from(slot.channels),
    droneId: slot.droneId,
    droneName: slot.droneName,
    // Finalize markers alongside frames/duration. Omit the field entirely
    // when none were placed so the persisted shape stays minimal.
    markers: slot.markers.length > 0 ? slot.markers.map((m) => ({ ...m })) : undefined,
    chunkCount: slot.chunkCount,
    ...(slot.truncatedAtMs !== undefined ? { truncatedAtMs: slot.truncatedAtMs } : {}),
  };
  await indexRecording(recording);
  return recording;
}
