/**
 * @module mock/mock-mavlink-frames.test
 * @description The demo protocol feeds the MAVLink Inspector real frames:
 * encoded with the frame encoder, decoded by MAVLinkParser, and only while
 * someone listens. It also reports one primary demo link and a disconnect.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { MockProtocol } from "../mock-protocol";
import { decodeAttitude, decodeHeartbeat } from "@/lib/protocol/mavlink-messages";
import type { MAVLinkFrame } from "@/lib/protocol/mavlink-parser";

afterEach(() => vi.useRealTimers());

describe("MockProtocol MAVLink frame feed", () => {
  it("emits HEARTBEAT, ATTITUDE, GLOBAL_POSITION_INT and VFR_HUD with real layouts", () => {
    vi.useFakeTimers();
    const mock = new MockProtocol();
    const frames: MAVLinkFrame[] = [];
    const unsub = mock.onMavlinkFrame((f) => frames.push(f));
    vi.advanceTimersByTime(500);
    expect(new Set(frames.map((f) => f.msgId))).toEqual(new Set([0, 30, 33, 74]));

    const hb = decodeHeartbeat(frames.find((f) => f.msgId === 0)!.payload);
    expect(hb.autopilot).toBe(mock.getVehicleInfo().autopilotType);
    const att = decodeAttitude(frames.find((f) => f.msgId === 30)!.payload);
    expect(Number.isFinite(att.yaw)).toBe(true);

    unsub();
    const count = frames.length;
    vi.advanceTimersByTime(1000);
    expect(frames.length).toBe(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports one primary demo link and fires onDisconnect once", async () => {
    const mock = new MockProtocol();
    expect(mock.linkInfo).toHaveLength(1);
    expect(mock.linkInfo[0].isPrimary).toBe(true);
    const fired = vi.fn();
    mock.onDisconnect(fired);
    await mock.disconnect();
    await mock.disconnect();
    expect(fired).toHaveBeenCalledTimes(1);
  });
});
