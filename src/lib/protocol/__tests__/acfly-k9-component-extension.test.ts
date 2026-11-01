import { describe, expect, it } from "vitest";
import { handleACFlyK9ComponentExtension43 } from "../handlers/telemetry-handlers";
import { decodeACFlyK9ComponentExtension43 } from "../messages";
import { buildFrame } from "../encoders/frame";
import { CRC_EXTRA, MAVLinkParser, PAYLOAD_LENGTHS } from "../mavlink-parser";
import { MSG_NAMES } from "../messages/msg-names";

function payloadView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function escPayload(): Uint8Array {
  const payload = new Uint8Array(48);
  const view = new DataView(payload.buffer);
  view.setUint16(0, 80, true);
  view.setUint8(2, 0);
  view.setUint8(3, 255);
  view.setUint8(4, 80);
  view.setUint8(5, 3);
  view.setUint16(6, 2, true);
  view.setUint32(8, 12600, true);
  view.setFloat32(12, 24.5, true);
  view.setFloat32(16, 11.25, true);
  view.setInt16(20, 625, true);
  view.setInt16(22, 0x7fff, true);
  return payload;
}

function payloadModule(): Uint8Array {
  const payload = new Uint8Array(48);
  const view = new DataView(payload.buffer);
  view.setUint16(0, 81, true);
  view.setUint8(2, 0);
  view.setUint8(3, 255);
  view.setUint8(4, 81);
  view.setUint8(5, 4);
  view.setUint32(6, 0b11111, true);
  view.setUint16(10, 123, true);
  view.setUint16(12, 456, true);
  view.setUint16(14, 789, true);
  view.setInt16(16, -25, true);
  view.setInt16(18, 315, true);
  view.setUint16(20, 500, true);
  view.setUint16(22, 1000, true);
  view.setUint16(24, 80, true);
  view.setUint16(26, 60, true);
  return payload;
}

describe("ACFly K9 COMPONENT_EXTENSION43", () => {
  it("registers the documented MAVLink 2 ID, CRC, length, and name", () => {
    expect(CRC_EXTRA.get(500)).toBe(243);
    expect(PAYLOAD_LENGTHS.get(500)).toBe(48);
    expect(MSG_NAMES[500]).toBe("COMPONENT_EXTENSION43");

    const parser = new MAVLinkParser();
    let restoredLength = 0;
    parser.onFrame((frame) => { restoredLength = frame.payload.byteLength; });
    parser.feed(buildFrame(500, escPayload(), 1, 1, 0));
    expect(restoredLength).toBe(48);
  });

  it("decodes ESC data and converts sentinel temperatures", () => {
    const decoded = decodeACFlyK9ComponentExtension43(payloadView(escPayload()));
    expect(decoded).toMatchObject({
      messageType: 80,
      targetNetwork: 0,
      targetSystem: 255,
      targetComponent: 80,
      motorId: 3,
      errorFlags: 2,
      rpm: 12600,
      voltage: 24.5,
      current: 11.25,
      escTemperature: 625,
      motorTemperature: 0x7fff,
    });

    const esc: unknown[] = [];
    handleACFlyK9ComponentExtension43(payloadView(escPayload()), [(data) => esc.push(data)], []);
    expect(esc[0]).toMatchObject({
      motorId: 3,
      rpm: 12600,
      voltage: 24.5,
      current: 11.25,
      escTemperature: 62.5,
      motorTemperature: undefined,
    });
  });

  it("decodes winch/payload status bits and documented metric scales", () => {
    const decoded = decodeACFlyK9ComponentExtension43(payloadView(payloadModule()));
    expect(decoded).toMatchObject({
      messageType: 81,
      targetComponent: 81,
      moduleId: 4,
      statusFlags: 31,
      hookLocked: true,
      weightExceeded: true,
      winchAtUpperLimit: true,
      winchAtLowerLimit: true,
      fuseActive: true,
      cargoWeightKg: 12.3,
      totalWeightKg: 45.6,
      ropeLengthCm: 789,
      speedCmPerSecond: -25,
      fuseTemperature: 315,
      maximumLoadKg: 50,
      maximumRopeLengthCm: 1000,
      maximumUpSpeedCmPerSecond: 80,
      maximumDownSpeedCmPerSecond: 60,
    });

    const payloadTelemetry: unknown[] = [];
    handleACFlyK9ComponentExtension43(payloadView(payloadModule()), [], [(data) => payloadTelemetry.push(data)]);
    expect(payloadTelemetry[0]).toMatchObject({
      moduleId: 4,
      hookLocked: true,
      cargoWeightKg: 12.3,
      totalWeightKg: 45.6,
      ropeLengthCm: 789,
      speedCmPerSecond: -25,
      fuseTemperature: 31.5,
    });
  });

  it("ignores unsupported or mismatched message types", () => {
    const unknownType = new Uint8Array(48);
    new DataView(unknownType.buffer).setUint16(0, 99, true);
    expect(decodeACFlyK9ComponentExtension43(payloadView(unknownType))).toBeNull();

    const wrongComponent = escPayload();
    new DataView(wrongComponent.buffer).setUint8(4, 81);
    expect(decodeACFlyK9ComponentExtension43(payloadView(wrongComponent))).toBeNull();

    const esc: unknown[] = [];
    const winch: unknown[] = [];
    handleACFlyK9ComponentExtension43(payloadView(unknownType), [(data) => esc.push(data)], [(data) => winch.push(data)]);
    expect(esc).toEqual([]);
    expect(winch).toEqual([]);
  });
});
