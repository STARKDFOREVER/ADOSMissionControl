/**
 * The agent batches MAVLink frames into one MQTT publish. The relay
 * transport hands the payload to the streaming parser as one chunk, and
 * the parser must split it back into every frame it carries.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { MqttMavlinkTransport } from "@/lib/protocol/transport/mqtt-mavlink";
import { MAVLinkParser } from "@/lib/protocol/mavlink-parser";
import { encodeHeartbeat } from "@/lib/protocol/encoders/core";

function fakeClient() {
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  return {
    on(event: string, cb: (...a: unknown[]) => void) {
      (handlers[event] ??= []).push(cb);
      if (event === "connect") queueMicrotask(() => cb());
    },
    subscribe(_t: string, _o: unknown, cb?: (e: Error | null) => void) {
      cb?.(null);
    },
    publish(_t: string, _p: Uint8Array, _o: unknown, cb?: (e?: Error | null) => void) {
      cb?.(undefined);
    },
    end() {},
    deliver(topic: string, payload: Uint8Array) {
      for (const cb of handlers.message ?? []) cb(topic, payload);
    },
  };
}

afterEach(() => {
  vi.doUnmock("mqtt");
  vi.resetModules();
});

describe("MQTT MAVLink batching", () => {
  it("two concatenated frames in one MQTT payload yield two parsed frames", async () => {
    const client = fakeClient();
    vi.doMock("mqtt", () => ({ connect: () => client }));
    const transport = new MqttMavlinkTransport("mavlink");
    await transport.connect("device-alpha", "ws://broker.invalid", {
      username: "viewer",
      password: "secret",
    });

    const parser = new MAVLinkParser();
    const frames: Array<{ systemId: number; msgId: number }> = [];
    parser.onFrame((f) => frames.push({ systemId: f.systemId, msgId: f.msgId }));
    transport.on("data", (bytes) => parser.feed(bytes));

    const a = encodeHeartbeat(1, 1);
    const b = encodeHeartbeat(2, 1);
    const batch = new Uint8Array(a.length + b.length);
    batch.set(a, 0);
    batch.set(b, a.length);
    client.deliver("ados/device-alpha/mavlink/tx", batch);

    expect(frames).toEqual([
      { systemId: 1, msgId: 0 },
      { systemId: 2, msgId: 0 },
    ]);
  });
});
