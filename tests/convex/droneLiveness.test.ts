/**
 * Liveness split: every heartbeat records `lastSeen` in `cmd_droneLiveness`,
 * and the `cmd_drones` row (which every fleet-list subscriber reads) is only
 * patched when a denormalised fleet-card value changes.
 *
 * @license GPL-3.0-only
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import * as cmdDroneStatus from "../../convex/cmdDroneStatus";
import * as cmdDroneLiveness from "../../convex/cmdDroneLiveness";
import { invoke, makeCtx, type FakeCtx } from "./fakeConvexCtx";

const BASE = { deviceId: "drone-a", version: "0.18.4", uptimeSeconds: 60, fcConnected: true };

function seedDrone(ctx: FakeCtx) {
  return ctx.db.seed("cmd_drones", [
    { userId: "user-1", deviceId: "drone-a", name: "Alpha", apiKey: "k", pairedAt: 1, lastSeen: 1 },
  ])[0];
}

/** Count `db.patch` calls that target `id`. */
function countPatches(ctx: FakeCtx, id: string): () => number {
  let count = 0;
  const original = ctx.db.patch.bind(ctx.db);
  ctx.db.patch = async (target: string, updates: Record<string, unknown>) => {
    if (target === id) count += 1;
    return original(target, updates);
  };
  return () => count;
}

describe("pushStatus liveness split", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pushStatus_no_cmd_drones_patch_when_pills_unchanged", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const ctx = makeCtx();
    const drone = seedDrone(ctx);
    const patches = countPatches(ctx, drone._id);

    await invoke(cmdDroneStatus.pushStatus, ctx, BASE);
    expect(patches()).toBe(1);
    expect(ctx.db.rows("cmd_droneLiveness")[0]?.lastSeen).toBe(1_700_000_000_000);

    vi.setSystemTime(1_700_000_005_000);
    await invoke(cmdDroneStatus.pushStatus, ctx, BASE);
    expect(patches()).toBe(1);
    const liveness = ctx.db.rows("cmd_droneLiveness");
    expect(liveness).toHaveLength(1);
    expect(liveness[0].lastSeen).toBe(1_700_000_005_000);
  });

  it("patches cmd_drones again when a fleet-card value changes", async () => {
    const ctx = makeCtx();
    const drone = seedDrone(ctx);
    const patches = countPatches(ctx, drone._id);

    await invoke(cmdDroneStatus.pushStatus, ctx, BASE);
    await invoke(cmdDroneStatus.pushStatus, ctx, { ...BASE, fcConnected: false });
    expect(patches()).toBe(2);
    expect(ctx.db.rows("cmd_drones")[0].fcConnected).toBe(false);
  });

  it("listMyDroneLiveness returns the caller's drones with their heartbeat time", async () => {
    const ctx = makeCtx({ subject: "user-1|session-1" });
    seedDrone(ctx);
    ctx.db.seed("cmd_drones", [
      { userId: "user-2", deviceId: "drone-b", name: "Other", apiKey: "k2", pairedAt: 1 },
    ]);
    await invoke(cmdDroneStatus.pushStatus, ctx, BASE);
    const rows = (await invoke(cmdDroneLiveness.listMyDroneLiveness, ctx, {})) as Array<{
      deviceId: string;
      lastSeen: number | null;
    }>;
    expect(rows.map((r) => r.deviceId)).toEqual(["drone-a"]);
    expect(rows[0].lastSeen).toBeGreaterThan(1);
  });
});
