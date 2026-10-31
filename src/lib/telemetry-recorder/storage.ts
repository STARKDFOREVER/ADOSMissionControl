import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import { useHistoryStore } from "@/stores/history-store";
import {
  MAX_UNREFERENCED_LIVE_RECORDINGS,
  RECORDING_CHUNK_FRAMES,
  type TelemetryFrame,
  type TelemetryRecording,
} from "./types";

// ── IDB Keys ─────────────────────────────────────────────────

const IDB_RECORDINGS_PREFIX = "altcmd:recording:";
const IDB_RECORDINGS_INDEX = "altcmd:recordings-index";

// ── Storage failure notification ─────────────────────────────

type StorageFailureListener = (err: unknown) => void;
const _storageFailureListeners = new Set<StorageFailureListener>();

/**
 * Be told when telemetry could not be written to storage (a recording chunk,
 * or a flight's recording). Returns the unsubscribe function.
 */
export function onRecordingStorageFailure(listener: StorageFailureListener): () => void {
  _storageFailureListeners.add(listener);
  return () => {
    _storageFailureListeners.delete(listener);
  };
}

/** Tell every listener that telemetry could not be stored. */
export function reportRecordingStorageFailure(err: unknown): void {
  console.warn("[telemetry-recorder] telemetry could not be stored", err);
  for (const listener of _storageFailureListeners) listener(err);
}

export function chunkKey(recordingId: string, index: number): string {
  return index === 0 ? `${IDB_RECORDINGS_PREFIX}${recordingId}` : `${IDB_RECORDINGS_PREFIX}${recordingId}:${index}`;
}

export async function readChunks(recordingId: string, chunkCount: number): Promise<TelemetryFrame[]> {
  const out: TelemetryFrame[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk = (await idbGet(chunkKey(recordingId, i))) as TelemetryFrame[] | undefined;
    if (chunk) for (const f of chunk) out.push(f);
  }
  return out;
}

async function deleteChunks(recordingId: string, chunkCount: number): Promise<void> {
  for (let i = 0; i < chunkCount; i++) await idbDel(chunkKey(recordingId, i));
}

// ── Internal: the recordings index ───────────────────────────

/**
 * Every read-modify-write of the index runs on this chain, so two writers
 * (two drones disarming together, an import during a finalize) never read
 * the same index and overwrite each other's entry.
 */
let _indexChain: Promise<unknown> = Promise.resolve();

function mutateIndex(mutate: (index: TelemetryRecording[]) => Promise<TelemetryRecording[]>): Promise<void> {
  const run = _indexChain.then(async () => {
    const index: TelemetryRecording[] = (await idbGet(IDB_RECORDINGS_INDEX)) ?? [];
    await idbSet(IDB_RECORDINGS_INDEX, await mutate(index));
  });
  _indexChain = run.catch(() => undefined);
  return run;
}

/** Recording ids used by flight records that are not in the trash. */
async function referencedRecordingIds(): Promise<Set<string>> {
  await useHistoryStore.getState().ensureLoaded();
  const ids = new Set<string>();
  for (const r of useHistoryStore.getState().records) {
    if (!r.deleted && r.recordingId) ids.add(r.recordingId);
  }
  return ids;
}

/**
 * Add {@link recording} to the index, replacing an entry with the same id.
 * Live recordings no active flight record uses are kept to the newest
 * {@link MAX_UNREFERENCED_LIVE_RECORDINGS}; a recording a flight in history
 * uses, an import, and the recording being added are never deleted. A
 * trashed record whose recording is deleted stops claiming telemetry.
 */
export async function indexRecording(recording: TelemetryRecording): Promise<void> {
  const referenced = await referencedRecordingIds();
  const evicted: string[] = [];
  await mutateIndex(async (index) => {
    const next = index.filter((r) => r.id !== recording.id);
    next.push(recording);
    const unreferenced = (r: TelemetryRecording) => !r.imported && !referenced.has(r.id);
    let excess = next.filter(unreferenced).length - MAX_UNREFERENCED_LIVE_RECORDINGS;
    if (excess <= 0) return next;
    const kept: TelemetryRecording[] = [];
    for (const r of next) {
      if (excess > 0 && r.id !== recording.id && unreferenced(r)) {
        excess--;
        await deleteChunks(r.id, r.chunkCount ?? 1);
        evicted.push(r.id);
      } else {
        kept.push(r);
      }
    }
    return kept;
  });
  if (evicted.length === 0) return;
  const gone = new Set(evicted);
  const history = useHistoryStore.getState();
  const orphaned = history.records.filter((r) => r.recordingId !== undefined && gone.has(r.recordingId));
  if (orphaned.length === 0) return;
  for (const r of orphaned) history.updateRecord(r.id, { recordingId: undefined, hasTelemetry: false });
  await history.persistToIDB();
}

/**
 * Store {@link frames} as {@link recording}'s chunks and index it. A failed
 * write removes the chunks already written and rejects, so nothing half
 * stored is left behind.
 */
async function storeRecording(recording: TelemetryRecording, frames: TelemetryFrame[]): Promise<TelemetryRecording> {
  const chunkCount = Math.max(1, Math.ceil(frames.length / RECORDING_CHUNK_FRAMES));
  let written = 0;
  try {
    for (; written < chunkCount; written++) {
      const from = written * RECORDING_CHUNK_FRAMES;
      await idbSet(chunkKey(recording.id, written), frames.slice(from, from + RECORDING_CHUNK_FRAMES));
    }
  } catch (err) {
    await deleteChunks(recording.id, written).catch(() => undefined);
    throw err;
  }
  const stored: TelemetryRecording = { ...recording, chunkCount };
  await indexRecording(stored);
  return stored;
}

function recordingOf(
  id: string,
  name: string,
  frames: TelemetryFrame[],
  options: { droneId?: string; droneName?: string; startTimeMs?: number },
): TelemetryRecording {
  const startTime = options.startTimeMs ?? Date.now();
  const lastOffsetMs = frames.length > 0 ? frames[frames.length - 1].offsetMs : 0;
  const channels = new Set<string>();
  for (const frame of frames) channels.add(frame.channel);
  return {
    id,
    name,
    startTime,
    endTime: startTime + lastOffsetMs,
    durationMs: lastOffsetMs,
    frameCount: frames.length,
    channels: Array.from(channels),
    droneId: options.droneId,
    droneName: options.droneName,
  };
}

/**
 * Store the frames of one flight cut from a longer live recording (see
 * {@link recordingFramesBetween}) as a live recording of its own. Rejects
 * when storage fails; nothing is left stored then.
 */
export async function saveFlightRecording(
  frames: TelemetryFrame[],
  options: { droneId: string; droneName?: string; startTimeMs: number; truncatedAtMs?: number },
): Promise<TelemetryRecording> {
  const id = `rec-${options.startTimeMs}-${Math.random().toString(36).slice(2, 8)}`;
  const recording = recordingOf(id, `Recording ${new Date(options.startTimeMs).toLocaleString()}`, frames, options);
  if (options.truncatedAtMs !== undefined) recording.truncatedAtMs = options.truncatedAtMs;
  return await storeRecording(recording, frames);
}

/**
 * Insert a fully-formed recording into IDB without going through the live
 * arm/disarm slot machinery. Used by importers (dataflash, ULog, tlog) that
 * already have all frames in memory and just need them stored
 * + indexed so the existing Charts/Replay/Analysis pipeline can read them.
 *
 * Caller is responsible for choosing a unique `id` (e.g. `dataflash-<uuid>`).
 * Imported recordings are exempt from the live-recording cap: the user
 * explicitly asked to import them. Re-importing the same id replaces it.
 */
export async function setRecordingFromFrames(
  id: string,
  name: string,
  frames: TelemetryFrame[],
  options: {
    droneId?: string;
    droneName?: string;
    startTimeMs?: number;
  } = {},
): Promise<TelemetryRecording> {
  const recording: TelemetryRecording = { ...recordingOf(id, name, frames, options), imported: true };
  return await storeRecording(recording, frames);
}

/**
 * List all saved recordings.
 */
export async function listRecordings(): Promise<TelemetryRecording[]> {
  return (await idbGet(IDB_RECORDINGS_INDEX)) ?? [];
}

/**
 * Load frames for a recording.
 */
export async function loadRecordingFrames(recordingId: string): Promise<TelemetryFrame[]> {
  const entry = (await listRecordings()).find((r) => r.id === recordingId);
  return readChunks(recordingId, entry?.chunkCount ?? 1);
}

/**
 * Delete a recording.
 */
export async function deleteRecording(recordingId: string): Promise<void> {
  const entry = (await listRecordings()).find((r) => r.id === recordingId);
  await deleteChunks(recordingId, entry?.chunkCount ?? 1);
  await mutateIndex(async (index) => index.filter((r) => r.id !== recordingId));
}
