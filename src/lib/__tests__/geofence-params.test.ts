/**
 * @license GPL-3.0-only
 *
 * The fence floor reaches the flight controller: ArduPilot gets FENCE_ALT_MIN
 * and the FENCE_TYPE floor bit and reports it back; PX4, which has no floor,
 * refuses a non-zero one instead of dropping it.
 */

import { describe, expect, it, vi } from "vitest";

import { readFenceParams, writeFenceParams } from "../geofence-elements";
import type { DroneProtocol } from "@/lib/protocol/types";

function protocol(params: Record<string, number> = {}) {
  const setParameter = vi.fn().mockResolvedValue({ success: true, message: "" });
  const getParameter = vi.fn(async (name: string) => ({ name, value: params[name], type: 9, index: 0, count: 1 }));
  const p: DroneProtocol = { setParameter, getParameter } as never;
  return { p, setParameter };
}

const snap = { enabled: true, maxAltitude: 60, minAltitude: 10, breachAction: "RTL" as const };

describe("fence altitude floor", () => {
  it("writes FENCE_ALT_MIN and the floor bit on ArduPilot", async () => {
    const { p, setParameter } = protocol();
    expect((await writeFenceParams(p, "ardupilot-copter", snap)).success).toBe(true);
    expect(setParameter).toHaveBeenCalledWith("FENCE_TYPE", 4 | 1 | 8);
    expect(setParameter).toHaveBeenCalledWith("FENCE_ALT_MIN", 10);
  });

  it("refuses a floor on PX4 without writing anything", async () => {
    const { p, setParameter } = protocol();
    const r = await writeFenceParams(p, "px4", snap);
    expect(r.success).toBe(false);
    expect(setParameter).not.toHaveBeenCalled();
  });

  it("reads the floor back only when its FENCE_TYPE bit is set", async () => {
    const base = { FENCE_ENABLE: 1, FENCE_ALT_MAX: 60, FENCE_ACTION: 1, FENCE_ALT_MIN: 12 };
    const on = await readFenceParams(protocol({ ...base, FENCE_TYPE: 13 }).p, "ardupilot-copter");
    const off = await readFenceParams(protocol({ ...base, FENCE_TYPE: 5 }).p, "ardupilot-copter");
    expect(on.minAltitude).toBe(12);
    expect(off.minAltitude).toBe(0);
  });
});

describe("ArduPilot fence parameters", () => {
  it("uploads Land as AUTOLAND_OR_RTL on ArduPlane, which ignores always-land", async () => {
    const { p, setParameter } = protocol();
    await writeFenceParams(p, "ardupilot-plane", { ...snap, breachAction: "LAND" });
    expect(setParameter).toHaveBeenCalledWith("FENCE_ACTION", 8);
    const copter = protocol();
    await writeFenceParams(copter.p, "ardupilot-copter", { ...snap, breachAction: "LAND" });
    expect(copter.setParameter).toHaveBeenCalledWith("FENCE_ACTION", 2);
    const back = await readFenceParams(protocol({ FENCE_ENABLE: 1, FENCE_ACTION: 8, FENCE_TYPE: 4 }).p, "ardupilot-plane");
    expect(back.breachAction).toBe("LAND");
  });

  it("reads no ceiling when the FENCE_TYPE altitude bit is clear (stock Plane: polygon only, FENCE_ALT_MAX 100)", async () => {
    const r = await readFenceParams(protocol({ FENCE_ENABLE: 1, FENCE_ACTION: 1, FENCE_TYPE: 4, FENCE_ALT_MAX: 100 }).p, "ardupilot-plane");
    expect(r.maxAltitude).toBe(0);
  });

  it("reads the home circle radius and keeps the circle bit when writing FENCE_TYPE", async () => {
    const r = await readFenceParams(protocol({ FENCE_ENABLE: 1, FENCE_ACTION: 1, FENCE_TYPE: 7, FENCE_ALT_MAX: 100, FENCE_RADIUS: 300 }).p, "ardupilot-copter");
    expect(r.homeCircleRadiusM).toBe(300);
    const { p, setParameter } = protocol({ FENCE_TYPE: 7 });
    await writeFenceParams(p, "ardupilot-copter", { ...snap, minAltitude: 0 });
    expect(setParameter).toHaveBeenCalledWith("FENCE_TYPE", 4 | 2 | 1);
  });
});
