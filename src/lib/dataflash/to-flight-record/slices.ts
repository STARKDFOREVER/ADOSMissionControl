import type { DataflashLog, DataflashRecord } from "../parser";
import { num } from "./fields";

/** ArduPilot EV (event) numbers we care about for arm/disarm splitting. */
const EV_ARMED = 10;
const EV_DISARMED = 11;
const EV_AUTO_ARMED = 15;

/**
 * Every message this converter reads. Parsing only these (plus PARM, for the
 * parameter table) skips the high-rate IMU/EKF/PID rows a flight record never
 * uses.
 */
export const DATAFLASH_FLIGHT_MESSAGES: ReadonlySet<string> = new Set([
  "EV",
  "ARM",
  "ATT",
  "POS",
  "GPS",
  "BAT",
  "VIBE",
  "RCIN",
  "RCOU",
  "MODE",
  "PARM",
]);

export interface FlightSlice {
  /** ArduPilot TimeUS at the arm event. */
  startUs: number;
  /** ArduPilot TimeUS at the disarm event, or the log's last TimeUS. */
  endUs: number;
  /** The log ended with the vehicle still armed: no disarm closed the flight. */
  endedArmed: boolean;
}

/**
 * Walk the log and detect every armed→disarmed pair. If the log only contains
 * ARM/DISARM events without `EV` rows, falls back to the ARMED state column
 * on the ARM message itself. A flight still armed when the log ends (brown-out,
 * battery ejection, crash) is closed at the log's last TimeUS rather than
 * dropped. If there are no arm events at all, treats the whole log as one
 * flight (best-effort).
 */
export function detectFlightSlices(log: DataflashLog): FlightSlice[] {
  const evRows = (log.messages.get("EV") ?? []) as DataflashRecord[];
  const armRows = (log.messages.get("ARM") ?? []) as DataflashRecord[];

  type StateChange = { us: number; armed: boolean };
  const changes: StateChange[] = [];

  for (const r of evRows) {
    const us = num(r, "TimeUS");
    const id = num(r, "Id");
    if (us === undefined || id === undefined) continue;
    if (id === EV_ARMED || id === EV_AUTO_ARMED) {
      changes.push({ us, armed: true });
    } else if (id === EV_DISARMED) {
      changes.push({ us, armed: false });
    }
  }

  // Fallback / supplement: ARM messages carry the explicit state.
  for (const r of armRows) {
    const us = num(r, "TimeUS");
    const armState = num(r, "ArmState");
    if (us === undefined || armState === undefined) continue;
    changes.push({ us, armed: armState === 1 });
  }

  changes.sort((a, b) => a.us - b.us);

  // One pass for the log's TimeUS span. A .bin holds 10^5..10^6 records, so
  // spreading them into Math.min/Math.max overflows the call stack.
  let firstUs = Infinity;
  let lastUs = -Infinity;
  let stampedRows = 0;
  for (const bucket of log.messages.values()) {
    for (const r of bucket) {
      const us = num(r, "TimeUS");
      if (us === undefined) continue;
      if (us < firstUs) firstUs = us;
      if (us > lastUs) lastUs = us;
      stampedRows += 1;
    }
  }

  const slices: FlightSlice[] = [];
  let currentStartUs: number | null = null;
  for (const c of changes) {
    if (c.armed && currentStartUs === null) {
      currentStartUs = c.us;
    } else if (!c.armed && currentStartUs !== null) {
      slices.push({ startUs: currentStartUs, endUs: c.us, endedArmed: false });
      currentStartUs = null;
    }
  }
  if (currentStartUs !== null) {
    slices.push({ startUs: currentStartUs, endUs: Math.max(currentStartUs, lastUs), endedArmed: true });
  }

  if (slices.length === 0 && stampedRows >= 2) {
    slices.push({ startUs: firstUs, endUs: lastUs, endedArmed: false });
  }

  return slices;
}
