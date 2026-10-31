import type { DataflashLog } from "../parser";
import type { FlightRecord } from "@/lib/types";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";
import { decimatePath } from "@/lib/flight-lifecycle/decimate";
import { collectSliceFrames } from "./frames";
import type { FlightSlice } from "./slices";

export interface BuiltFlight {
  record: FlightRecord;
  frames: TelemetryFrame[];
}

export function buildFlight(
  log: DataflashLog,
  slice: FlightSlice,
  idx: number,
  refEpoch: number,
  firstStartUs: number,
  droneId: string,
  droneName: string,
  sourceFilename: string | undefined,
): BuiltFlight {
  // Spread imported flights along the wall clock by each slice's relative offset
  // from the first armed event in the file.
  const safeStartMs = refEpoch + Math.round((slice.startUs - firstStartUs) / 1000);
  const durationSec = Math.max(0, Math.round((slice.endUs - slice.startUs) / 1_000_000));
  const endMs = safeStartMs + durationSec * 1000;

  const { frames, path, stats } = collectSliceFrames(log, slice);

  // Battery used %: prefer start/end voltage delta projected onto a Li chemistry
  // sag curve (not great), otherwise use the last RemPct.
  let batteryUsed: number | undefined;
  if (stats.lastBattRem !== undefined && stats.lastBattRem >= 0) {
    batteryUsed = Math.max(0, Math.min(100, Math.round(100 - stats.lastBattRem)));
  } else if (stats.battStartV !== undefined && stats.battEndV !== undefined && stats.battStartV > stats.battEndV) {
    batteryUsed = Math.max(0, Math.min(100, Math.round(((stats.battStartV - stats.battEndV) / stats.battStartV) * 100)));
  }

  const recordingId = `dataflash-${droneId}-${idx}-${slice.startUs}`;
  const startName = sourceFilename ?? "imported";

  const record: FlightRecord = {
    id: `dataflash-${idx}-${slice.startUs}-${slice.endUs}`,
    droneId,
    droneName,
    date: safeStartMs,
    startTime: safeStartMs,
    endTime: endMs,
    duration: durationSec,
    distance: Math.round(stats.distanceM),
    maxAlt: Math.round(stats.maxAltM),
    maxSpeed: Math.round(stats.maxSpeedMs * 10) / 10,
    avgSpeed: stats.speedCount > 0 ? Math.round((stats.speedSum / stats.speedCount) * 10) / 10 : 0,
    batteryStartV: stats.battStartV,
    batteryEndV: stats.battEndV,
    batteryUsed,
    waypointCount: 0,
    // A log that stops while armed (brown-out, battery ejection, crash) did
    // not end in a normal disarm.
    status: slice.endedArmed ? "aborted" : "completed",
    path: path.length >= 2 ? decimatePath(path) : undefined,
    takeoffLat: stats.firstFix?.[0],
    takeoffLon: stats.firstFix?.[1],
    landingLat: stats.prevLat,
    landingLon: stats.prevLon,
    recordingId,
    hasTelemetry: frames.length > 0,
    updatedAt: Date.now(),
    source: "dataflash",
    sourceFilename: startName,
  };

  return { record, frames };
}
