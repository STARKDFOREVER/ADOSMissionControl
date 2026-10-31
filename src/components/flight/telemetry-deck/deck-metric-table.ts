/**
 * @module deck-metric-table
 * @description One row per telemetry deck metric: how to read its raw value
 * from the deck's fresh channels and how to format it. The raw value feeds
 * the severity verdict; the formatted value is what the cell shows.
 * @license GPL-3.0-only
 */

import type { TelemetryDeckMetricId } from "@/stores/settings-store";
import type {
  AttitudeData,
  BatteryData,
  EkfData,
  GpsData,
  NavControllerData,
  PositionData,
  RadioData,
  VfrData,
  VibrationData,
  WindData,
} from "@/lib/types";
import { formatOr, NO_READING } from "@/lib/format";
import { normalizeHeading } from "@/lib/telemetry-utils";

/**
 * The deck's inputs. Every channel is its fresh sample or `undefined`; the
 * derived figures are `undefined` when any input they need is absent.
 */
export interface DeckChannels {
  pos?: PositionData;
  vfr?: VfrData;
  bat?: BatteryData;
  gps?: GpsData;
  att?: AttitudeData;
  wind?: WindData;
  radio?: RadioData;
  nav?: NavControllerData;
  ekf?: EkfData;
  vibration?: VibrationData;
  heading?: number;
  powerWatts?: number;
  estimatedMinutes?: number;
}

/** Formatting that needs the caller's locale. */
export interface DeckFormatContext {
  gpsFixLabel: (fixType: number) => string;
}

interface DeckMetricRow {
  raw: (c: DeckChannels) => number | undefined;
  format: (raw: number | undefined, fmt: DeckFormatContext) => string;
}

/** A 000-359 bearing, or the no-reading placeholder. */
function bearing3(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value)
    ? NO_READING
    : `${String(Math.round(normalizeHeading(value))).padStart(3, "0")}°`;
}

/** Rounded to an integer with `unit`, or the no-reading placeholder. */
function rounded(value: number | undefined, unit = ""): string {
  return value === undefined ? NO_READING : `${Math.round(value)}${unit}`;
}

const fixedRow = (raw: DeckMetricRow["raw"], digits: number, unit = ""): DeckMetricRow => ({
  raw,
  format: (v) => formatOr(v, digits, unit),
});

const bearingRow = (raw: DeckMetricRow["raw"]): DeckMetricRow => ({ raw, format: bearing3 });

// Every RADIO_STATUS field comes from one message. With none received the
// whole group is unknown, so it reads unknown as a group: "0 errors" and "0%
// buffer" are as much a fabricated reading as "0 dBm", and the buffer figure
// trips its own critical threshold.
const radioRow = (raw: DeckMetricRow["raw"], unit = ""): DeckMetricRow => ({
  raw,
  format: (v) => rounded(v, unit),
});

/**
 * Every deck metric. Undefined raw values are metrics that were never
 * received; they carry no threshold verdict, so an absent link or GPS raises
 * no false alarm.
 */
export const DECK_METRIC_TABLE: Record<TelemetryDeckMetricId, DeckMetricRow> = {
  relAlt: fixedRow((c) => c.pos?.relativeAlt, 1, "m"),
  airspeed: fixedRow((c) => c.vfr?.airspeed ?? c.pos?.airSpeed, 1, "m/s"),
  groundspeedMs: fixedRow((c) => c.pos?.groundSpeed ?? c.vfr?.groundspeed, 1, "m/s"),
  throttle: fixedRow((c) => c.vfr?.throttle, 0, "%"),
  climbRate: fixedRow((c) => c.vfr?.climb ?? c.pos?.climbRate, 1, "m/s"),
  // Undefined until a GPS message arrives. "0 SATS" reads as a receiver that
  // has locked onto nothing, which is a different claim from having no fix
  // report at all, and it trips the low-satellite alarm. Fix type carries the
  // same problem: 0 is "No Fix", which is below the critical threshold.
  gpsFix: {
    raw: (c) => c.gps?.fixType,
    format: (v, fmt) => (v === undefined ? NO_READING : fmt.gpsFixLabel(v)),
  },
  satellites: { raw: (c) => c.gps?.satellites, format: (v) => rounded(v) },
  gpsHdop: fixedRow((c) => c.gps?.hdop, 1),
  batteryVoltage: fixedRow((c) => c.bat?.voltage, 1, "V"),
  batteryCurrent: fixedRow((c) => c.bat?.current, 1, "A"),
  batteryConsumed: fixedRow((c) => c.bat?.consumed, 0, "mAh"),
  roll: fixedRow((c) => c.att?.roll, 1, "°"),
  pitch: fixedRow((c) => c.att?.pitch, 1, "°"),
  yaw: bearingRow((c) => c.att?.yaw ?? c.heading),
  wpDistance: fixedRow((c) => c.nav?.wpDist, 0, "m"),
  xtrackError: fixedRow((c) => c.nav?.xtrackError, 1, "m"),
  altError: fixedRow((c) => c.nav?.altError, 1, "m"),
  navBearing: bearingRow((c) => c.nav?.navBearing),
  targetBearing: bearingRow((c) => c.nav?.targetBearing),
  windSpeed: fixedRow((c) => c.wind?.speed, 1, "m/s"),
  windDirection: bearingRow((c) => c.wind?.direction),
  radioRssi: radioRow((c) => c.radio?.rssi),
  remrssi: radioRow((c) => c.radio?.remrssi),
  noise: radioRow((c) => c.radio?.noise),
  remnoise: radioRow((c) => c.radio?.remnoise),
  rxerrors: radioRow((c) => c.radio?.rxerrors),
  txbuf: radioRow((c) => c.radio?.txbuf, "%"),
  powerWatts: fixedRow((c) => c.powerWatts, 0, "W"),
  estFlightMin: fixedRow((c) => c.estimatedMinutes, 1, "m"),
  ekfVelRatio: fixedRow((c) => c.ekf?.velocityVariance, 2),
  ekfPosHorizRatio: fixedRow((c) => c.ekf?.posHorizVariance, 2),
  vibeX: fixedRow((c) => c.vibration?.vibrationX, 1),
  vibeY: fixedRow((c) => c.vibration?.vibrationY, 1),
  vibeZ: fixedRow((c) => c.vibration?.vibrationZ, 1),
};

/** Every deck metric id, in table order. */
export const DECK_METRIC_IDS = Object.keys(DECK_METRIC_TABLE) as TelemetryDeckMetricId[];

export interface DeckMetricReadings {
  raw: Record<TelemetryDeckMetricId, number | undefined>;
  display: Record<TelemetryDeckMetricId, string>;
}

/** Raw and formatted value of every metric, read once from `channels`. */
export function readDeckMetrics(channels: DeckChannels, fmt: DeckFormatContext): DeckMetricReadings {
  const raw = {} as Record<TelemetryDeckMetricId, number | undefined>;
  const display = {} as Record<TelemetryDeckMetricId, string>;
  for (const id of DECK_METRIC_IDS) {
    const row = DECK_METRIC_TABLE[id];
    const value = row.raw(channels);
    raw[id] = value;
    display[id] = row.format(value, fmt);
  }
  return { raw, display };
}
