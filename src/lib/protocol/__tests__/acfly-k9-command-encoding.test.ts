import { describe, expect, it } from "vitest";
import { encodeACFlyK9ManualControl, encodeACFlyK9SetHomePosition, encodeHeartbeat } from "../encoders";
import { MAVLinkParser } from "../mavlink-parser";

function parse(frame: Uint8Array) {
  const parser = new MAVLinkParser();
  const received: Array<{ msgId: number; payload: DataView }> = [];
  parser.onFrame((message) => received.push(message));
  parser.feed(frame);
  expect(received).toHaveLength(1);
  return received[0];
}

describe("ACFly K9 MAVLink encoding", () => {
  it("uses the documented GCS heartbeat base mode when requested", () => {
    const frame = encodeHeartbeat(255, 190, 192);
    expect(frame[0]).toBe(0xfd);
    expect(frame[16]).toBe(192);
    expect(frame[17]).toBe(4);
  });

  it("sends the 26-byte MANUAL_CONTROL extension with enabled extensions and neutral axes", () => {
    const frame = encodeACFlyK9ManualControl(1, 1000, -1000, 0, 250, 3);
    expect(frame[1]).toBe(26);
    const message = parse(frame);
    expect(message.msgId).toBe(69);
    expect(message.payload.byteLength).toBe(30);
    expect(message.payload.getInt16(0, true)).toBe(1000);
    expect(message.payload.getInt16(2, true)).toBe(-1000);
    expect(message.payload.getInt16(4, true)).toBe(0);
    expect(message.payload.getInt16(6, true)).toBe(250);
    expect(message.payload.getUint16(8, true)).toBe(3);
    expect(message.payload.getUint8(10)).toBe(1);
    expect(message.payload.getUint16(11, true)).toBe(0);
    expect(message.payload.getUint8(13)).toBe(0x80);
    expect(message.payload.getInt16(14, true)).toBe(0);
    expect(message.payload.getInt16(16, true)).toBe(0);
    for (let offset = 18; offset <= 24; offset += 2) {
      expect(message.payload.getInt16(offset, true)).toBe(32767);
    }
  });

  it("encodes K9 SET_HOME_POSITION using the documented packed layout", () => {
    const message = parse(encodeACFlyK9SetHomePosition(
      211234567, 1131234567, 123450, 1, 1_800_000_000_000_000,
      { latitudeE7: 231234567, longitudeE7: 1141234567, altitudeMm: 250000 },
    ));
    expect(message.msgId).toBe(243);
    expect(message.payload.byteLength).toBe(61);
    expect(message.payload.getInt32(0, true)).toBe(211234567);
    expect(message.payload.getInt32(4, true)).toBe(1131234567);
    expect(message.payload.getInt32(8, true)).toBe(123450);
    expect(message.payload.getInt32(40, true)).toBe(231234567);
    expect(message.payload.getInt32(44, true)).toBe(1141234567);
    expect(message.payload.getFloat32(48, true)).toBe(250000);
    expect(message.payload.getUint8(52)).toBe(1);
    expect(message.payload.getUint32(53, true)).toBe(0x28988000);
  });
});
