/**
 * The `/agent/status` heartbeat filter: every key `pushStatus` declares is
 * forwarded once it passes its coercer or declared type; undeclared keys are
 * dropped and named; a value of the wrong type is dropped rather than failing
 * the whole tick.
 *
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";

import { pushStatusArgs } from "../../convex/cmdDroneStatus";
import {
  MAX_JSON_BODY_BYTES,
  PUSH_STATUS_KEYS,
  buildStatusPayload,
  readJsonObject,
} from "../../convex/lib/agentStatusPayload";

const BASE = { deviceId: "drone-a", version: "0.18.4", uptimeSeconds: 60 };

describe("buildStatusPayload", () => {
  it("keys the filter on exactly the declared pushStatus args", () => {
    expect([...PUSH_STATUS_KEYS].sort()).toEqual(Object.keys(pushStatusArgs).sort());
  });

  it("forwards the WFB USB-health mirror, cloud posture and the peer fields", () => {
    const { payload } = buildStatusPayload({
      ...BASE,
      wfbAdapterUsbDegraded: null,
      wfbAdapterUsbSpeedMbps: 480,
      cloudPosture: "cloud",
      cloudRelayUrl: null,
      cloudflareUrl: "https://node.example.com",
      peerDeviceId: "gs-1",
      peerRole: null,
      peerChannel: 149,
      peerRssiDbm: -61,
      peerSeenAtUnix: 1_700_000_000,
    });
    expect(payload).toMatchObject({
      wfbAdapterUsbDegraded: null,
      wfbAdapterUsbSpeedMbps: 480,
      cloudPosture: "cloud",
      cloudRelayUrl: null,
      cloudflareUrl: "https://node.example.com",
      peerDeviceId: "gs-1",
      peerRole: null,
      peerChannel: 149,
      peerRssiDbm: -61,
      peerSeenAtUnix: 1_700_000_000,
    });
  });

  it("forwards plugin inventory, peripheral states and the peripheral manifest", () => {
    const peripherals = [{ category: "display", type: "spi-lcd" }];
    const { payload } = buildStatusPayload({
      ...BASE,
      pluginInventory: [{ plugin_id: "com.example.cam", version: "1.0.0", status: "running" }],
      peripheralStates: [{ id: "lcd0", connected: true }],
      peripherals,
    });
    expect(payload.pluginInventory).toEqual([
      { plugin_id: "com.example.cam", version: "1.0.0", status: "running" },
    ]);
    expect(payload.peripheralStates).toEqual([{ id: "lcd0", connected: true }]);
    expect(payload.peripherals).toBe(peripherals);
  });

  it("drops undeclared root keys and names them, never the stripped auth keys", () => {
    const { payload, unknownFields } = buildStatusPayload({
      ...BASE,
      apiKey: "secret",
      agentVersion: "0.18.4",
      zFutureField: 1,
      aFutureField: "x",
    });
    expect(unknownFields).toEqual(["aFutureField", "zFutureField"]);
    expect(payload).toEqual(BASE);
  });

  it("drops a scalar of the wrong type instead of failing the tick", () => {
    const { payload } = buildStatusPayload({
      ...BASE,
      temperature: null,
      cpuPercent: "high",
      fcConnected: "yes",
      boardName: "rpi-5",
    });
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("cpuPercent");
    expect(payload).not.toHaveProperty("fcConnected");
    expect(payload.boardName).toBe("rpi-5");
  });

  it("removes a block its coercer rejects and a non-object plugin-state map", () => {
    const { payload } = buildStatusPayload({
      ...BASE,
      pluginState: ["not", "a", "map"],
      macStability: "bad",
      cpuHistory: [1, 2, 3],
    });
    expect(payload).not.toHaveProperty("pluginState");
    expect(payload).not.toHaveProperty("macStability");
    expect(payload.cpuHistory).toEqual([1, 2, 3]);
  });
});

describe("readJsonObject", () => {
  it("refuses an oversized body with 413", async () => {
    const big = JSON.stringify({ blob: "x".repeat(MAX_JSON_BODY_BYTES) });
    const result = await readJsonObject(new Request("http://localhost", { method: "POST", body: big }));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
  });

  it("refuses a JSON array with 400 and parses an object", async () => {
    const array = await readJsonObject(new Request("http://localhost", { method: "POST", body: "[]" }));
    expect((array as Response).status).toBe(400);
    const object = await readJsonObject(
      new Request("http://localhost", { method: "POST", body: '{"a":1}' }),
    );
    expect(object).toEqual({ a: 1 });
  });
});
