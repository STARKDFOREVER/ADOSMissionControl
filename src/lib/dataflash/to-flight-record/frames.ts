import type { DataflashLog, DataflashRecord } from "../parser";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";
import { haversineDistance } from "@/lib/geo/distance";
import { isFirstInstance, num, usToOffsetMs } from "./fields";
import type { FlightSlice } from "./slices";

/** A GPS row within this much of a POS row supplies its ground speed and course. */
const GPS_JOIN_WINDOW_US = 500_000;
/** Per-slice accumulators the flight record's summary is built from. */
export interface SliceStats {
  prevLat?: number;
  prevLon?: number;
  distanceM: number;
  maxAltM: number;
  maxSpeedMs: number;
  speedSum: number;
  speedCount: number;
  battStartV?: number;
  battEndV?: number;
  firstFix?: [number, number];
  lastBattRem?: number;
}

/**
 * Build the synthetic telemetry frames of one slice, sorted by offset, with
 * every position fix and the summary accumulators.
 */
export function collectSliceFrames(
  log: DataflashLog,
  slice: FlightSlice,
): { frames: TelemetryFrame[]; path: [number, number][]; stats: SliceStats } {
  const stats: SliceStats = { distanceM: 0, maxAltM: 0, maxSpeedMs: 0, speedSum: 0, speedCount: 0 };
  // Walk every message bucket once and build telemetry frames + stats.
  const frames: TelemetryFrame[] = [];
  // Every position fix of the slice; decimated to the stored path at the end.
  const path: [number, number][] = [];


  // Channel mapping: dataflash message name → recorder channel name.
  const ATT_ROWS = (log.messages.get("ATT") ?? []) as DataflashRecord[];
  const POS_ROWS = (log.messages.get("POS") ?? []) as DataflashRecord[];
  const GPS_ROWS = (log.messages.get("GPS") ?? []) as DataflashRecord[];
  const BAT_ROWS = (log.messages.get("BAT") ?? []) as DataflashRecord[];
  const VIBE_ROWS = (log.messages.get("VIBE") ?? []) as DataflashRecord[];
  const RCIN_ROWS = (log.messages.get("RCIN") ?? []) as DataflashRecord[];
  const RCOU_ROWS = (log.messages.get("RCOU") ?? []) as DataflashRecord[];
  const MODE_ROWS = (log.messages.get("MODE") ?? []) as DataflashRecord[];

  const inSlice = (us: number | undefined): boolean =>
    us !== undefined && us >= slice.startUs && us <= slice.endUs;

  // Attitude — ATT logs degrees, which is the recorded `attitude` contract
  // (live frames are AttitudeData in degrees), so the values pass through.
  for (const r of ATT_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "attitude",
      data: {
        roll: num(r, "Roll"),
        pitch: num(r, "Pitch"),
        yaw: num(r, "Yaw"),
        timestamp: us,
      },
    });
  }

  // Ground speed and course over ground come from the first GPS receiver;
  // POS carries neither. A position takes the nearest GPS row within
  // GPS_JOIN_WINDOW_US, and has neither field when no row is that close.
  const gpsMotion: { us: number; spd?: number; crs?: number }[] = [];
  for (const r of GPS_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us) || !isFirstInstance(r, "I")) continue;
    gpsMotion.push({ us: us!, spd: num(r, "Spd"), crs: num(r, "GCrs") });
  }
  let gi = 0;

  // POS — primary position source. `Alt` is AMSL; the height above home is
  // `RelHomeAlt` on current firmware. Older logs lack it, so fall back to the
  // AMSL altitude minus the first fix of the flight (the arm point).
  let slicePosBaseAlt: number | undefined;
  for (const r of POS_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    const lat = num(r, "Lat");
    const lon = num(r, "Lng");
    const alt = num(r, "Alt");
    if (lat === undefined || lon === undefined || alt === undefined) continue;
    if (slicePosBaseAlt === undefined) slicePosBaseAlt = alt;
    const relativeAlt = num(r, "RelHomeAlt") ?? alt - slicePosBaseAlt;

    if (stats.prevLat !== undefined && stats.prevLon !== undefined) {
      stats.distanceM += haversineDistance(stats.prevLat, stats.prevLon, lat, lon);
    }
    stats.prevLat = lat;
    stats.prevLon = lon;
    stats.firstFix ??= [lat, lon];
    if (relativeAlt > stats.maxAltM) stats.maxAltM = relativeAlt;

    while (gi + 1 < gpsMotion.length && Math.abs(gpsMotion[gi + 1].us - us!) <= Math.abs(gpsMotion[gi].us - us!)) gi++;
    const motion = gpsMotion[gi] && Math.abs(gpsMotion[gi].us - us!) <= GPS_JOIN_WINDOW_US ? gpsMotion[gi] : undefined;

    const offsetMs = usToOffsetMs(us!, slice.startUs);
    frames.push({
      offsetMs,
      channel: "position",
      data: {
        lat,
        lon,
        alt,
        relativeAlt,
        ...(motion?.spd !== undefined ? { groundSpeed: motion.spd } : {}),
        ...(motion?.crs !== undefined ? { heading: motion.crs } : {}),
        timestamp: us,
      },
    });
    path.push([lat, lon]);
  }

  // GPS — speed + sat count + HDOP, from the first receiver only.
  for (const r of GPS_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us) || !isFirstInstance(r, "I")) continue;
    const spd = num(r, "Spd");
    if (spd !== undefined && spd > stats.maxSpeedMs) stats.maxSpeedMs = spd;
    if (spd !== undefined && spd > 0) {
      stats.speedSum += spd;
      stats.speedCount += 1;
    }
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "gps",
      data: {
        satellites: num(r, "NSats"),
        hdop: num(r, "HDop"),
        fixType: num(r, "Status"),
        lat: num(r, "Lat"),
        lon: num(r, "Lng"),
        alt: num(r, "Alt"),
        timestamp: us,
      },
    });
  }

  // Battery — voltage / current / remaining %, from the first monitor only.
  for (const r of BAT_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us) || !isFirstInstance(r, "Inst")) continue;
    const volt = num(r, "Volt") ?? num(r, "VoltR");
    const rem = num(r, "RemPct") ?? num(r, "BatRem") ?? num(r, "Pct");
    if (stats.battStartV === undefined && volt !== undefined && volt > 0) stats.battStartV = volt;
    if (volt !== undefined && volt > 0) stats.battEndV = volt;
    if (rem !== undefined) stats.lastBattRem = rem;
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "battery",
      data: {
        voltage: volt,
        current: num(r, "Curr"),
        remaining: rem ?? -1,
        consumed: num(r, "CurrTot"),
        timestamp: us,
      },
    });
  }

  // Vibration. Current firmware logs one VIBE row per IMU (`IMU`, `Clip`),
  // every IMU's row sharing the write's TimeUS; older logs carry all three
  // clip counters (`Clip0..2`) on one row. Levels come from the first IMU and
  // each IMU's clip count lands in its own slot; a count the log lacks stays
  // absent rather than reading as zero clipping.
  const clipsAt = new Map<number, Record<string, number>>();
  for (const r of VIBE_ROWS) {
    const us = num(r, "TimeUS");
    const imu = num(r, "IMU");
    const clip = num(r, "Clip");
    if (!inSlice(us) || imu === undefined || imu > 2 || clip === undefined) continue;
    const clips = clipsAt.get(us!) ?? {};
    clips[`clipping${imu}`] = clip;
    clipsAt.set(us!, clips);
  }
  for (const r of VIBE_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us) || !isFirstInstance(r, "IMU")) continue;
    let clips: Record<string, number> = {};
    if (num(r, "IMU") !== undefined) {
      clips = clipsAt.get(us!) ?? {};
    } else {
      for (const i of [0, 1, 2]) {
        const clip = num(r, `Clip${i}`);
        if (clip !== undefined) clips[`clipping${i}`] = clip;
      }
    }
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "vibration",
      data: {
        vibrationX: num(r, "VibeX") ?? 0,
        vibrationY: num(r, "VibeY") ?? 0,
        vibrationZ: num(r, "VibeZ") ?? 0,
        ...clips,
        timestamp: us,
      },
    });
  }

  // RC inputs.
  for (const r of RCIN_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    const channels = [
      num(r, "C1") ?? 0,
      num(r, "C2") ?? 0,
      num(r, "C3") ?? 0,
      num(r, "C4") ?? 0,
      num(r, "C5") ?? 0,
      num(r, "C6") ?? 0,
      num(r, "C7") ?? 0,
      num(r, "C8") ?? 0,
    ];
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "rc",
      data: { channels, rssi: 255, timestamp: us },
    });
  }

  // Servo outputs.
  for (const r of RCOU_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    const out = [
      num(r, "C1") ?? 0,
      num(r, "C2") ?? 0,
      num(r, "C3") ?? 0,
      num(r, "C4") ?? 0,
      num(r, "C5") ?? 0,
      num(r, "C6") ?? 0,
      num(r, "C7") ?? 0,
      num(r, "C8") ?? 0,
    ];
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "servoOutput",
      data: { servos: out, timestamp: us },
    });
  }

  // Mode changes — emitted as events later via the analyzer; record as frames
  // for completeness.
  for (const r of MODE_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "mode",
      data: { mode: num(r, "Mode") ?? 0, reason: num(r, "Rsn") ?? 0, timestamp: us },
    });
  }

  // Sort by offset to ensure monotonic playback.
  frames.sort((a, b) => a.offsetMs - b.offsetMs);

  return { frames, path, stats };
}
