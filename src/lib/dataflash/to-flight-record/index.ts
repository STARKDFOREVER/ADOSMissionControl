/**
 * Convert a parsed ArduPilot DataFlash log into one or more FlightRecords.
 *
 * Splitting policy: walk EV (event) and ARM messages, slice the file into
 * runs between consecutive ARMED→DISARMED transitions, then build one
 * FlightRecord per run with synthetic TelemetryFrames so the existing
 * Charts / Replay / Analysis pipeline works unchanged.
 *
 * Input is a fully-parsed log from {@link parseDataflashLog}; output is an
 * array of records ready for `useHistoryStore.addRecord` plus the synthetic
 * frames written via `setRecordingFromFrames`.
 *
 * Pure function — no I/O. The caller persists frames to IDB.
 *
 * @module dataflash/to-flight-record
 * @license GPL-3.0-only
 */

import type { DataflashLog } from "../parser";
import { logClockOffsetMs } from "../gps-clock";
import { buildFlight, type BuiltFlight } from "./build-flight";
import { detectFlightSlices } from "./slices";

export { DATAFLASH_FLIGHT_MESSAGES, detectFlightSlices } from "./slices";
export type { BuiltFlight } from "./build-flight";

export interface DataflashConvertOptions {
  /** Identifier for the source drone — defaults to a parameter-derived hint. */
  droneId?: string;
  droneName?: string;
  /** Original filename for traceability (`my-flight.bin`). */
  sourceFilename?: string;
}

/**
 * Convert a parsed dataflash log into FlightRecords + frame buckets.
 *
 * Flight times come from the log's GPS clock. A log without GPS time gets the
 * import time instead and is marked `startTimeUnknown`, so nothing presents
 * that time as when the flight happened.
 *
 * The caller is expected to persist the frames via
 * {@link setRecordingFromFrames} and then call `useHistoryStore.addRecord`
 * for each returned `record`. The `record.recordingId` already points at the
 * synthetic id we'll use.
 */
export function dataflashToFlightRecords(log: DataflashLog, options: DataflashConvertOptions = {}): BuiltFlight[] {
  const slices = detectFlightSlices(log);
  if (slices.length === 0) return [];

  const firstStartUs = slices[0].startUs;
  const clockOffsetMs = logClockOffsetMs(log);
  const startTimeUnknown = clockOffsetMs === undefined;
  // Without a GPS clock the flights are placed at "now minus the log span",
  // keeping their spacing, and flagged as having no known date.
  const lastEndUs = slices[slices.length - 1].endUs;
  const totalSpanMs = Math.max(0, Math.round((lastEndUs - firstStartUs) / 1000));
  const refEpoch =
    clockOffsetMs !== undefined
      ? Math.round(clockOffsetMs + firstStartUs / 1000)
      : Date.now() - totalSpanMs;

  // Drone identification: prefer caller-supplied, otherwise derive from PARM
  // fields if present (SYSID_THISMAV / SYSID_MYGCS aren't ideal but the best
  // hint we have without a fleet binding).
  const sysid = log.params.get("SYSID_THISMAV");
  const droneId = options.droneId ?? `dataflash-sysid-${sysid ?? "unknown"}`;
  const droneName =
    options.droneName ?? (options.sourceFilename ? `Imported · ${options.sourceFilename}` : "Imported drone");

  return slices.map((slice, idx) => {
    const built = buildFlight(log, slice, idx, refEpoch, firstStartUs, droneId, droneName, options.sourceFilename);
    if (startTimeUnknown) built.record.startTimeUnknown = true;
    return built;
  });
}
