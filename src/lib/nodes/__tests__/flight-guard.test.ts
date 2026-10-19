/**
 * @module flight-guard.test
 * @description A Visor's flight controller is a sensor hub: every flight
 * action is refused at the protocol while reads and parameters pass; a drone
 * is unchanged.
 * @license GPL-3.0-only
 */

import { describe, expect, it, vi } from "vitest";
import type { DroneProtocol } from "@/lib/protocol/types";
import { NOT_A_FLIGHT_NODE, guardFlightActions } from "../flight-guard";
import { nodeCanFly, type NodeProfile } from "../node-profile";

const OK = { success: true, resultCode: 0, message: "ok" };

function fakeProtocol() {
  const raw = {
    isConnected: true,
    arm: vi.fn(async () => OK),
    setFlightMode: vi.fn(async () => OK),
    uploadMission: vi.fn(async () => OK),
    motorTest: vi.fn(async () => OK),
    sendManualControl: vi.fn(),
    getParameter: vi.fn(async () => ({ name: "X", value: 1 })),
    startCalibration: vi.fn(async () => OK),
  };
  return raw;
}

function guarded(profile: NodeProfile) {
  const raw = fakeProtocol();
  const p = guardFlightActions(raw as unknown as DroneProtocol, () => profile);
  return { raw, p };
}

describe("nodeCanFly", () => {
  it("never flies a Visor and leaves a drone (and an unread profile) flyable", () => {
    expect(nodeCanFly("visor")).toBe(false);
    expect(nodeCanFly("drone")).toBe(true);
    expect(nodeCanFly(undefined)).toBe(true);
  });
});

describe("guardFlightActions", () => {
  it("refuses every flight action on a Visor without sending", async () => {
    const { raw, p } = guarded("visor");
    expect((await p.arm()).message).toBe(NOT_A_FLIGHT_NODE);
    expect((await p.setFlightMode("LOITER" as never)).success).toBe(false);
    expect((await p.uploadMission([])).success).toBe(false);
    expect((await p.motorTest(1, 5, 1)).success).toBe(false);
    p.sendManualControl(0, 0, 0, 0, 0);
    expect(p.getManualControlBlockedReason?.()).toBe(NOT_A_FLIGHT_NODE);
    expect(raw.arm).not.toHaveBeenCalled();
    expect(raw.setFlightMode).not.toHaveBeenCalled();
    expect(raw.uploadMission).not.toHaveBeenCalled();
    expect(raw.motorTest).not.toHaveBeenCalled();
    expect(raw.sendManualControl).not.toHaveBeenCalled();
  });

  it("keeps a Visor's parameter and calibration paths", async () => {
    const { raw, p } = guarded("visor");
    await p.getParameter("X");
    await p.startCalibration("accel");
    expect(raw.getParameter).toHaveBeenCalledOnce();
    expect(raw.startCalibration).toHaveBeenCalledOnce();
    expect(p.isConnected).toBe(true);
  });

  it("passes every flight action through on a drone", async () => {
    const { raw, p } = guarded("drone");
    expect((await p.arm()).success).toBe(true);
    p.sendManualControl(0, 0, 0, 0, 0);
    expect(raw.arm).toHaveBeenCalledOnce();
    expect(raw.sendManualControl).toHaveBeenCalledOnce();
  });
});
