/**
 * A drone claimed by an anonymous browser session is owned by the marker
 * `browser:<session row id>`, not by a Convex account. A signed-in user's
 * fleet reads must never surface such a row, even one paired from the same
 * machine, and must still return the user's own drones.
 *
 * Exercised against the real exported handlers through `._handler`.
 *
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";

import * as drones from "../../convex/cmdDrones";
import * as droneStatus from "../../convex/cmdDroneStatus";
import { invoke, makeCtx, type FakeCtx } from "./fakeConvexCtx";

const NOW = Date.now();

function seed(ctx: FakeCtx) {
  ctx.db.seed("cmd_drones", [
    {
      userId: "browser:session-row-1",
      deviceId: "dev-anon",
      name: "Anonymous drone",
      apiKey: "ados_live_anon_key",
      lastSeen: NOW,
      fcConnected: false,
      pairedAt: NOW,
    },
    {
      userId: "user-a",
      deviceId: "dev-owned",
      name: "Owned drone",
      apiKey: "ados_live_owned_key",
      lastSeen: NOW,
      fcConnected: false,
      pairedAt: NOW,
    },
  ]);
}

describe("anonymous browser-owned drones", () => {
  it("never appear in listMyDrones for a signed-in user", async () => {
    const ctx = makeCtx({ subject: "user-a|session_1" });
    seed(ctx);
    const rows = (await invoke(drones.listMyDrones, ctx, {})) as Array<{
      deviceId: string;
    }>;
    expect(rows.map((r) => r.deviceId)).toEqual(["dev-owned"]);
  });

  it("never appear in listMyCloudStatuses for a signed-in user", async () => {
    const ctx = makeCtx({ subject: "user-a|session_1" });
    seed(ctx);
    const rows = (await invoke(droneStatus.listMyCloudStatuses, ctx, {})) as Array<{
      drone: { deviceId: string; userId: string };
    }>;
    expect(rows.map((r) => r.drone.deviceId)).toEqual(["dev-owned"]);
    expect(rows.some((r) => r.drone.userId.startsWith("browser:"))).toBe(false);
  });
});
