/**
 * @license GPL-3.0-only
 *
 * A reconnect cycle stops when a manual connect reaches the same endpoint,
 * when the operator disconnects the drone, or when it is stopped from the UI;
 * otherwise a superseded cycle lands a duplicate session or retries forever.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { wsConnect } = vi.hoisted(() => ({ wsConnect: vi.fn(async () => {}) }));

vi.mock("@/lib/protocol/transport/websocket", () => ({
  WebSocketTransport: class {
    connect = wsConnect;
    disconnect = async () => {};
  },
}));

import { ReconnectManager, RECONNECT_INTERVAL_MS } from "@/lib/reconnect-manager";
import type { ConnectionMeta } from "@/lib/connection-meta";
import { sameEndpoint, useReconnectStore } from "../reconnect-store";
import { useDroneManager } from "../drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { MockProtocol } from "@/mock/mock-protocol";
import type { Transport } from "@/lib/protocol/types";

const WS: ConnectionMeta = { type: "websocket", url: "ws://192.168.1.50:5760" };

function passiveTransport(): Transport {
  return {
    type: "websocket",
    connect: async () => {},
    disconnect: async () => {},
    send: () => {},
    on: () => {},
    off: () => {},
    isConnected: true,
    canCommand: true,
  };
}

let unbind: () => void;
let manager: ReconnectManager;

beforeEach(() => {
  vi.useFakeTimers();
  wsConnect.mockClear();
  useNodeRegistryStore.setState({ nodes: {}, lastUpdate: 0 });
  useDroneManager.getState().clear();
  manager = new ReconnectManager(() => {});
  unbind = useReconnectStore.getState().bind(manager);
});

afterEach(() => {
  manager.cancelAll();
  unbind();
  vi.useRealTimers();
});

describe("reconnect store", () => {
  it("mirrors a started cycle", () => {
    manager.startReconnect("fc:old", "Quad", WS);
    const entry = useReconnectStore.getState().entries.get("fc:old");
    expect(entry?.endpoint.url).toBe(WS.url);
    expect(entry?.attempts).toBe(0);
    expect(entry?.startedAt).toBeGreaterThan(0);
  });

  it("cancels the cycle when a manual connect reaches the same URL", async () => {
    manager.startReconnect("fc:old", "Quad", WS);
    const protocol = new MockProtocol();
    const vehicleInfo = await protocol.connect(passiveTransport());
    useDroneManager.getState().addDrone("fc:new", "Quad", protocol, passiveTransport(), vehicleInfo, { ...WS });

    expect(useReconnectStore.getState().entries.size).toBe(0);
    await vi.advanceTimersByTimeAsync(RECONNECT_INTERVAL_MS * 3);
    expect(wsConnect).not.toHaveBeenCalled();
  });

  it("keeps a cycle for a different endpoint", async () => {
    manager.startReconnect("fc:old", "Quad", WS);
    const protocol = new MockProtocol();
    const vehicleInfo = await protocol.connect(passiveTransport());
    useDroneManager.getState().addDrone("fc:new", "Other", protocol, passiveTransport(), vehicleInfo, {
      type: "websocket",
      url: "ws://192.168.1.51:5760",
    });
    expect(useReconnectStore.getState().entries.has("fc:old")).toBe(true);
  });

  it("cancels on an operator disconnect and on the stop action", async () => {
    manager.startReconnect("fc:a", "A", WS);
    manager.startReconnect("fc:b", "B", { type: "websocket", url: "ws://192.168.1.52:5760" });
    useDroneManager.getState().disconnectDrone("fc:a");
    useReconnectStore.getState().cancel("fc:b");
    expect(useReconnectStore.getState().entries.size).toBe(0);
    await vi.advanceTimersByTimeAsync(RECONNECT_INTERVAL_MS * 3);
    expect(wsConnect).not.toHaveBeenCalled();
  });

  it("retries at the fixed cadence with no cap until stopped", async () => {
    wsConnect.mockRejectedValue(new Error("refused"));
    manager.startReconnect("fc:a", "A", WS);
    await vi.advanceTimersByTimeAsync(RECONNECT_INTERVAL_MS * 10);
    expect(wsConnect).toHaveBeenCalledTimes(10);
    expect(useReconnectStore.getState().entries.get("fc:a")?.attempts).toBe(10);
    useReconnectStore.getState().cancel("fc:a");
    await vi.advanceTimersByTimeAsync(RECONNECT_INTERVAL_MS * 3);
    expect(wsConnect).toHaveBeenCalledTimes(10);
    wsConnect.mockReset();
  });
});

describe("sameEndpoint", () => {
  it("matches URL, serial VID:PID and proto/host/port", () => {
    expect(sameEndpoint(WS, { type: "websocket", url: WS.url })).toBe(true);
    expect(
      sameEndpoint(
        { type: "serial", portVendorId: 0x1209, portProductId: 0x5740 },
        { type: "serial", portVendorId: 0x1209, portProductId: 0x5740, baudRate: 57600 },
      ),
    ).toBe(true);
    expect(
      sameEndpoint(
        { type: "udp-proxy", proto: "udp", host: "192.168.1.50", port: 14550 },
        { type: "udp-proxy", proto: "udp", host: "192.168.1.50", port: 14550 },
      ),
    ).toBe(true);
    expect(
      sameEndpoint({ type: "serial" }, { type: "serial" }),
    ).toBe(false);
    expect(
      sameEndpoint(
        { type: "tcp", proto: "tcp", host: "192.168.1.50", port: 5760 },
        { type: "tcp", proto: "tcp", host: "192.168.1.50", port: 5761 },
      ),
    ).toBe(false);
  });
});
