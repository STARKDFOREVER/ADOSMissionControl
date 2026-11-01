import { describe, expect, it } from "vitest";
import { handleACFlyK9Battery } from "../handlers/telemetry-handlers";
import { decodeACFlyK9BatteryStatus } from "../messages";
import { buildFrame } from "../encoders/frame";
import { CRC_EXTRA, MAVLinkParser, PAYLOAD_LENGTHS } from "../mavlink-parser";
import { MSG_NAMES } from "../messages/msg-names";

function payloadView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

describe("ACFly K9 battery status", () => {
  it("registers the documented MAVLink 2 message id, CRC and payload length", () => {
    expect(CRC_EXTRA.get(602)).toBe(159);
    expect(PAYLOAD_LENGTHS.get(602)).toBe(72);
    expect(MSG_NAMES[602]).toBe("BATTERY_STATUS_ACFLY");
  });

  it("decodes fields and dispatches units supported by the shared battery telemetry", () => {
    const payload = new Uint8Array(72);
    const view = new DataView(payload.buffer);
    view.setUint32(0, 252, true);
    view.setUint32(4, 12000, true);
    view.setUint32(8, 7, true);
    view.setUint16(12, 3, true);
    view.setInt16(14, 0x7fff, true);
    view.setUint16(16, 10, true);
    view.setInt16(18, -25, true);
    view.setUint8(20, 2);
    view.setUint8(21, 95);
    view.setUint8(22, 80);
    view.setUint8(23, 6);
    view.setUint8(24, 210);

    expect(decodeACFlyK9BatteryStatus(payloadView(payload))).toMatchObject({
      voltage: 252,
      capacity: 12000,
      sequenceNum: 7,
      faultBitmask: 3,
      temperature: 0x7fff,
      cycleCount: 10,
      current: -25,
      id: 2,
      health: 95,
      remainingPercentage: 80,
      cellCount: 6,
    });
    expect(decodeACFlyK9BatteryStatus(payloadView(payload)).cellVoltages).toHaveLength(48);
    expect(decodeACFlyK9BatteryStatus(payloadView(payload)).cellVoltages[0]).toBe(210);

    const batteries: unknown[] = [];
    handleACFlyK9Battery(payloadView(payload), [(data) => batteries.push(data)]);
    expect(batteries[0]).toMatchObject({
      id: 2,
      voltage: 25.2,
      current: -2.5,
      remaining: 80,
      temperature: undefined,
      cellCount: 6,
    });
    expect(batteries[0]).not.toHaveProperty("cellVoltages");
  });

  it("parses a 72-byte MAVLink 2 frame and ignores the invalid pack-voltage sentinel", () => {
    const payload = new Uint8Array(72);
    new DataView(payload.buffer).setUint32(0, 0xffffffff, true);
    const frame = buildFrame(602, payload, 1, 1, 0);
    const parser = new MAVLinkParser();
    let restoredLength = 0;
    parser.onFrame((message) => { restoredLength = message.payload.byteLength; });
    parser.feed(frame);
    expect(restoredLength).toBe(72);

    const batteries: unknown[] = [];
    handleACFlyK9Battery(payloadView(payload), [(data) => batteries.push(data)]);
    expect(batteries).toEqual([]);
  });
});
