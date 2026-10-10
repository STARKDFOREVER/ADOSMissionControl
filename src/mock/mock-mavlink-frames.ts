/**
 * Demo MAVLink frame feed for the MAVLink Inspector.
 *
 * Encodes HEARTBEAT (0), ATTITUDE (30), GLOBAL_POSITION_INT (33) and VFR_HUD
 * (74) with the real frame encoder and decodes them through `MAVLinkParser`,
 * so the Inspector sees real wire layouts. The values are a synthetic slow
 * orbit around the mock home position. The timer runs only while someone is
 * subscribed.
 *
 * @module mock/mock-mavlink-frames
 */

import { buildFrame } from "@/lib/protocol/encoders/frame";
import { MAVLinkParser, type MAVLinkFrame } from "@/lib/protocol/mavlink-parser";
import type { VehicleInfo } from "@/lib/protocol/types";
import { MOCK_HOME_LAT, MOCK_HOME_LON } from "./mock-protocol-data";

/** Tick period of the demo feed (4 Hz). */
const FRAME_TICK_MS = 250;

/** One demo telemetry tick encoded as MAVLink v2 frames. */
export function encodeMockFrames(vehicle: VehicleInfo, t: number): Uint8Array[] {
  const sys = vehicle.systemId;
  const comp = vehicle.componentId;
  const bootMs = Math.round(t * 1000);
  const phase = t / 30; // one orbit every ~3 minutes
  const heading = ((phase * 180) / Math.PI) % 360;

  const hb = new Uint8Array(9);
  new DataView(hb.buffer).setUint32(0, 0, true);
  hb[4] = vehicle.vehicleType;
  hb[5] = vehicle.autopilotType;
  hb[6] = 0x81; // MAV_MODE_FLAG_SAFETY_ARMED | CUSTOM_MODE_ENABLED
  hb[7] = 4; // MAV_STATE_ACTIVE
  hb[8] = 3;

  const att = new DataView(new ArrayBuffer(28));
  att.setUint32(0, bootMs, true);
  att.setFloat32(4, 0.05 * Math.sin(t), true);
  att.setFloat32(8, 0.03 * Math.cos(t), true);
  att.setFloat32(12, ((heading > 180 ? heading - 360 : heading) * Math.PI) / 180, true);
  att.setFloat32(16, 0.05 * Math.cos(t), true);
  att.setFloat32(20, -0.03 * Math.sin(t), true);
  att.setFloat32(24, 1 / 30, true);

  const radius = 0.0009;
  const pos = new DataView(new ArrayBuffer(28));
  pos.setUint32(0, bootMs, true);
  pos.setInt32(4, Math.round((MOCK_HOME_LAT + radius * Math.cos(phase)) * 1e7), true);
  pos.setInt32(8, Math.round((MOCK_HOME_LON + radius * Math.sin(phase)) * 1e7), true);
  pos.setInt32(12, 950_000, true); // 950 m AMSL
  pos.setInt32(16, 50_000, true); // 50 m relative
  pos.setInt16(20, Math.round(-330 * Math.sin(phase)), true);
  pos.setInt16(22, Math.round(330 * Math.cos(phase)), true);
  pos.setInt16(24, 0, true);
  pos.setUint16(26, Math.round(heading * 100), true);

  const vfr = new DataView(new ArrayBuffer(20));
  vfr.setFloat32(0, 3.3, true);
  vfr.setFloat32(4, 3.3, true);
  vfr.setFloat32(8, 950, true);
  vfr.setFloat32(12, 0, true);
  vfr.setInt16(16, Math.round(heading), true);
  vfr.setUint16(18, 42, true);

  return [
    buildFrame(0, hb, sys, comp),
    buildFrame(30, new Uint8Array(att.buffer), sys, comp),
    buildFrame(33, new Uint8Array(pos.buffer), sys, comp),
    buildFrame(74, new Uint8Array(vfr.buffer), sys, comp),
  ];
}

/** Subscribe-able demo feed; the timer runs while at least one listener exists. */
export function createMockFrameFeed(vehicle: () => VehicleInfo): (cb: (frame: MAVLinkFrame) => void) => () => void {
  const listeners = new Set<(frame: MAVLinkFrame) => void>();
  const parser = new MAVLinkParser();
  parser.onFrame((frame) => {
    for (const cb of [...listeners]) cb(frame);
  });
  let timer: ReturnType<typeof setInterval> | null = null;
  const start = Date.now();
  return (cb) => {
    listeners.add(cb);
    timer ??= setInterval(() => {
      for (const frame of encodeMockFrames(vehicle(), (Date.now() - start) / 1000)) parser.feed(frame);
    }, FRAME_TICK_MS);
    return () => {
      listeners.delete(cb);
      if (listeners.size > 0 || timer === null) return;
      clearInterval(timer);
      timer = null;
    };
  };
}
