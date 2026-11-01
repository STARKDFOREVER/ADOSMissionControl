import { describe, expect, it } from "vitest";
import { handleACFlyK9MissionCurrent } from "../handlers/nav-safety-handlers";
import { decodeACFlyK9MissionCurrent } from "../messages";
import { buildFrame } from "../encoders/frame";
import { CRC_EXTRA, MAVLinkParser, PAYLOAD_LENGTHS } from "../mavlink-parser";
import { MSG_NAMES } from "../messages/msg-names";

function payloadView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function missionCurrent(): Uint8Array {
  const payload = new Uint8Array(38);
  const view = new DataView(payload.buffer);
  view.setUint16(0, 7, true);
  view.setUint16(2, 4, true);
  view.setUint16(4, 8500, true);
  view.setFloat32(6, 1.25, true);
  view.setFloat32(10, -2.5, true);
  view.setFloat32(14, 3.75, true);
  view.setFloat32(18, -4.125, true);
  view.setFloat32(22, 42.5, true);
  view.setFloat32(26, 5.5, true);
  view.setFloat32(30, 8.25, true);
  view.setFloat32(34, 12.75, true);
  return payload;
}

describe("ACFly K9 MISSION_CURRENT extensions", () => {
  it("uses the documented ID, CRC and 38-byte length implied by the last field offset", () => {
    expect(CRC_EXTRA.get(42)).toBe(28);
    expect(PAYLOAD_LENGTHS.get(42)).toBe(38);
    expect(MSG_NAMES[42]).toBe("MISSION_CURRENT");

    const parser = new MAVLinkParser();
    let restoredLength = 0;
    parser.onFrame((frame) => { restoredLength = frame.payload.byteLength; });
    parser.feed(buildFrame(42, missionCurrent(), 1, 1, 0));
    expect(restoredLength).toBe(38);
  });

  it("decodes all extended fields at their documented offsets", () => {
    const payload = missionCurrent();
    expect(decodeACFlyK9MissionCurrent(payloadView(payload))).toEqual({
      seq: 7,
      resumeSeq: 4,
      flag: 8500,
      heading: 1.25,
      vectorX: -2.5,
      vectorY: 3.75,
      vectorZ: -4.125,
      distance: 42.5,
      triggerInterval: 5.5,
      speed: 8.25,
      radius: 12.75,
    });

    const reports: unknown[] = [];
    handleACFlyK9MissionCurrent(payloadView(payload), [(data) => reports.push(data)]);
    expect(reports[0]).toMatchObject({
      seq: 7,
      resumeSeq: 4,
      flag: 8500,
      vectorX: -2.5,
      distance: 42.5,
      triggerInterval: 5.5,
      speed: 8.25,
      radius: 12.75,
    });
  });

  it("marks the documented INT16_MAX channel flag as invalid", () => {
    const payload = missionCurrent();
    new DataView(payload.buffer).setUint16(4, 0x7fff, true);
    const reports: unknown[] = [];
    handleACFlyK9MissionCurrent(payloadView(payload), [(data) => reports.push(data)]);
    expect(reports[0]).toMatchObject({ seq: 7, flag: undefined });
  });
});
