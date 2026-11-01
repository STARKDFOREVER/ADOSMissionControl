/**
 * Core MAVLink encoders: Heartbeat, CommandLong, CommandInt, SetMode, RequestDataStream.
 * @module protocol/encoders/core
 */

import { buildFrame } from "./frame";
import { setU8, writeI32 } from "./bounds";

// ── Heartbeat (ID 0) ────────────────────────────────────────

/**
 * Encode a GCS heartbeat.
 *
 * Sent at 1 Hz to keep the link alive.
 * type=6 (MAV_TYPE_GCS), autopilot=8 (MAV_AUTOPILOT_INVALID),
 * customMode=0, systemStatus=4 (MAV_STATE_ACTIVE). ACFly K9 requires
 * baseMode=192; other firmware keeps the MAVLink default of 0.
 */
export function encodeHeartbeat(sysId = 255, compId = 190, baseMode = 0): Uint8Array {
  const payload = new Uint8Array(9);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, 0, true);   // customMode
  payload[4] = 6;             // type = GCS
  payload[5] = 8;             // autopilot = INVALID
  payload[6] = baseMode;      // baseMode
  payload[7] = 4;             // systemStatus = ACTIVE
  payload[8] = 3;             // mavlinkVersion = v2
  return buildFrame(0, payload, sysId, compId);
}

// ── COMMAND_LONG (ID 76) ────────────────────────────────────

/**
 * Encode a COMMAND_LONG message.
 *
 * Generic command interface — most GCS actions (arm, disarm, takeoff,
 * calibration, motor test, etc.) go through this.
 */
export function encodeCommandLong(
  targetSys: number,
  targetComp: number,
  command: number,
  p1 = 0,
  p2 = 0,
  p3 = 0,
  p4 = 0,
  p5 = 0,
  p6 = 0,
  p7 = 0,
  sysId = 255,
  compId = 190,
  confirmation = 0,
): Uint8Array {
  const payload = new Uint8Array(33);
  const dv = new DataView(payload.buffer);
  dv.setFloat32(0, p1, true);
  dv.setFloat32(4, p2, true);
  dv.setFloat32(8, p3, true);
  dv.setFloat32(12, p4, true);
  dv.setFloat32(16, p5, true);
  dv.setFloat32(20, p6, true);
  dv.setFloat32(24, p7, true);
  dv.setUint16(28, command, true);
  payload[30] = targetSys;
  payload[31] = targetComp;
  payload[32] = confirmation & 0xff; // confirmation count (incremented on retry)
  return buildFrame(76, payload, sysId, compId);
}

// ── COMMAND_INT (ID 75) ─────────────────────────────────────

/**
 * Encode a COMMAND_INT message.
 *
 * Like COMMAND_LONG but param5/param6 (x/y) are int32 for lat/lon * 1e7 precision
 * instead of float32 (which loses ~1m accuracy at drone-relevant coordinates).
 */
export function encodeCommandInt(
  targetSys: number,
  targetComp: number,
  frame: number,
  command: number,
  current: number,
  autocontinue: number,
  p1 = 0,
  p2 = 0,
  p3 = 0,
  p4 = 0,
  x = 0,
  y = 0,
  z = 0,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(35);
  const dv = new DataView(payload.buffer);
  dv.setFloat32(0, p1, true);
  dv.setFloat32(4, p2, true);
  dv.setFloat32(8, p3, true);
  dv.setFloat32(12, p4, true);
  dv.setInt32(16, x, true);     // lat * 1e7
  dv.setInt32(20, y, true);     // lon * 1e7
  dv.setFloat32(24, z, true);   // alt
  dv.setUint16(28, command, true);
  payload[30] = targetSys;
  payload[31] = targetComp;
  payload[32] = frame;
  payload[33] = current;
  payload[34] = autocontinue;
  return buildFrame(75, payload, sysId, compId);
}

/**
 * Encode the ACFly K9 SET_HOME_POSITION dialect layout (ID 243).
 * K9 specifies approach coordinates as int32 bit patterns in float fields.
 */
export function encodeACFlyK9SetHomePosition(
  latitudeE7: number,
  longitudeE7: number,
  altitudeMm: number,
  targetSys: number,
  timeUsec: number,
  approach?: { latitudeE7: number; longitudeE7: number; altitudeMm: number },
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(61);
  const dv = new DataView(payload.buffer);
  if (latitudeE7 < -900_000_000 || latitudeE7 > 900_000_000) {
    throw new RangeError(`ACFly K9 home latitude: expected -900000000..900000000, received ${latitudeE7}`);
  }
  if (longitudeE7 < -1_800_000_000 || longitudeE7 > 1_800_000_000) {
    throw new RangeError(`ACFly K9 home longitude: expected -1800000000..1800000000, received ${longitudeE7}`);
  }
  if (!Number.isSafeInteger(timeUsec) || timeUsec < 0) {
    throw new RangeError(`ACFly K9 home timestamp: expected a non-negative safe integer, received ${timeUsec}`);
  }
  const approachLatitudeE7 = approach?.latitudeE7 ?? 0;
  const approachLongitudeE7 = approach?.longitudeE7 ?? 0;
  const approachAltitudeMm = approach?.altitudeMm ?? 0;
  if (approachLatitudeE7 < -900_000_000 || approachLatitudeE7 > 900_000_000) {
    throw new RangeError(`ACFly K9 approach latitude: expected -900000000..900000000, received ${approachLatitudeE7}`);
  }
  if (approachLongitudeE7 < -1_800_000_000 || approachLongitudeE7 > 1_800_000_000) {
    throw new RangeError(`ACFly K9 approach longitude: expected -1800000000..1800000000, received ${approachLongitudeE7}`);
  }
  if (!Number.isFinite(approachAltitudeMm)) {
    throw new RangeError(`ACFly K9 approach altitude must be finite; received ${approachAltitudeMm}`);
  }
  writeI32(dv, 0, latitudeE7, "ACFly K9 home latitude");
  writeI32(dv, 4, longitudeE7, "ACFly K9 home longitude");
  writeI32(dv, 8, altitudeMm, "ACFly K9 home altitude");
  dv.setFloat32(12, 0, true);
  dv.setFloat32(16, 0, true);
  dv.setFloat32(20, 0, true);
  for (let i = 0; i < 4; i++) dv.setFloat32(24 + i * 4, 0, true);
  writeI32(dv, 40, approachLatitudeE7, "ACFly K9 approach latitude");
  writeI32(dv, 44, approachLongitudeE7, "ACFly K9 approach longitude");
  dv.setFloat32(48, approachAltitudeMm, true);
  setU8(payload, 52, targetSys, "ACFly K9 target system");
  const time = timeUsec;
  dv.setUint32(53, time >>> 0, true);
  dv.setUint32(57, Math.floor(time / 0x100000000), true);
  return buildFrame(243, payload, sysId, compId);
}

// ── SET_MODE (ID 11) ────────────────────────────────────────

/** Set the flight mode on the target system. */
export function encodeSetMode(
  targetSys: number,
  baseMode: number,
  customMode: number,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(6);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, customMode, true);
  payload[4] = targetSys;
  payload[5] = baseMode;
  return buildFrame(11, payload, sysId, compId);
}

// ── REQUEST_DATA_STREAM (ID 66) ──────────────────────────────

/**
 * Encode a REQUEST_DATA_STREAM message.
 *
 * Requests the FC to start (or stop) sending a specific MAVLink data stream
 * at a given rate. ArduPilot requires this (or non-zero SRn_* params) to
 * begin streaming telemetry like ATTITUDE, GPS, VFR_HUD, BATTERY, etc.
 *
 * @param targetSys    - Target system ID
 * @param targetComp   - Target component ID
 * @param streamId     - MAVLink data stream ID (e.g. 6=POSITION, 10=EXTRA1)
 * @param messageRate  - Requested rate in Hz
 * @param startStop    - 1 to start, 0 to stop
 */
export function encodeRequestDataStream(
  targetSys: number,
  targetComp: number,
  streamId: number,
  messageRate: number,
  startStop: number,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(6);
  const dv = new DataView(payload.buffer);
  dv.setUint16(0, messageRate, true);  // req_message_rate (uint16)
  payload[2] = targetSys;              // target_system
  payload[3] = targetComp;             // target_component
  payload[4] = streamId;              // req_stream_id
  payload[5] = startStop;             // start_stop (1=start, 0=stop)
  return buildFrame(66, payload, sysId, compId);
}

// ── SET_GPS_GLOBAL_ORIGIN (ID 48) ───────────────────────────

/**
 * Encode a SET_GPS_GLOBAL_ORIGIN message.
 *
 * Sets the EKF origin on the target system. This is a message (id 48), not a
 * MAV_CMD — the flight controller adopts the origin on receipt and does not
 * return a COMMAND_ACK, so callers treat it as fire-and-forget.
 *
 * | Offset | Type   | Field         |
 * |--------|--------|---------------|
 * | 0      | int32  | latitude  (degE7)  |
 * | 4      | int32  | longitude (degE7)  |
 * | 8      | int32  | altitude  (mm)     |
 * | 12     | uint8  | target_system      |
 * | 13     | uint64 | time_usec (v2 extension, 0 = FC fills) |
 *
 * @param targetSys - Target system ID
 * @param latE7     - Latitude in degrees * 1e7
 * @param lonE7     - Longitude in degrees * 1e7
 * @param altMm     - Altitude in millimeters (AMSL)
 */
export function encodeSetGpsGlobalOrigin(
  targetSys: number,
  latE7: number,
  lonE7: number,
  altMm: number,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(21);
  const dv = new DataView(payload.buffer);
  dv.setInt32(0, latE7, true);   // latitude (degE7)
  dv.setInt32(4, lonE7, true);   // longitude (degE7)
  dv.setInt32(8, altMm, true);   // altitude (mm)
  payload[12] = targetSys;       // target_system
  dv.setBigUint64(13, BigInt(0), true); // time_usec (extension, 0 = FC timestamps)
  return buildFrame(48, payload, sysId, compId);
}
