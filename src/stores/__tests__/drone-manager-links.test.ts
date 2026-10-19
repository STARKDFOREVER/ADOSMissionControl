/**
 * @license GPL-3.0-only
 *
 * The protocol, not the first transport, decides when a multi-link drone is
 * gone; a replaced session never reads as a link loss; removing the last link
 * is an operator disconnect; identity that arrives after connect reaches the
 * stamped reconnect identity.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { useDroneManager, onUnexpectedDisconnect } from "../drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { MockProtocol } from "@/mock/mock-protocol";
import type { AutopilotVersionData, LinkInfo, Transport, VehicleInfo } from "@/lib/protocol/types";
import { unguardedProtocol } from "@/lib/nodes/flight-guard";

interface TestTransport extends Transport {
  emitClose(): void;
}

function testTransport(): TestTransport {
  const closeHandlers = new Set<(data: void) => void>();
  return {
    type: "websocket",
    connect: async () => {},
    disconnect: async () => {},
    send: () => {},
    on: (event, handler) => {
      if (event === "close") closeHandlers.add(handler as (data: void) => void);
    },
    off: (event, handler) => {
      if (event === "close") closeHandlers.delete(handler as (data: void) => void);
    },
    isConnected: true,
    canCommand: true,
    emitClose: () => {
      for (const h of [...closeHandlers]) h();
    },
  };
}

interface Controlled {
  protocol: MockProtocol;
  vehicleInfo: VehicleInfo;
  setConnected(v: boolean): void;
  setCommandTransport(t: Transport | null): void;
  setLinks(links: LinkInfo[]): void;
  fireDisconnect(): void;
  removeLink: (linkId: string) => Promise<void>;
  fireAutopilotVersion(data: AutopilotVersionData): void;
}

/** A MockProtocol whose link state, loss signal and identity frames the test drives. */
async function controlledProtocol(): Promise<Controlled> {
  const protocol = new MockProtocol();
  const vehicleInfo = await protocol.connect(testTransport());
  let connected = true;
  let commandTransport: Transport | null = null;
  let links: LinkInfo[] = [];
  const disconnectCbs = new Set<() => void>();
  const avCbs = new Set<(d: AutopilotVersionData) => void>();
  const fireDisconnect = () => {
    for (const cb of [...disconnectCbs]) cb();
  };
  const removeLink = vi.fn(async () => {});
  Object.defineProperty(protocol, "isConnected", { get: () => connected });
  Object.defineProperty(protocol, "commandTransport", { get: () => commandTransport });
  Object.defineProperty(protocol, "linkInfo", { get: () => links });
  Object.assign(protocol, {
    onDisconnect: (cb: () => void) => {
      disconnectCbs.add(cb);
      return () => disconnectCbs.delete(cb);
    },
    onAutopilotVersion: (cb: (d: AutopilotVersionData) => void) => {
      avCbs.add(cb);
      return () => avCbs.delete(cb);
    },
    // The adapter reports its loss synchronously from inside disconnect().
    disconnect: async () => {
      connected = false;
      fireDisconnect();
    },
    removeLink,
  });
  return {
    protocol,
    vehicleInfo,
    setConnected: (v) => (connected = v),
    setCommandTransport: (t) => (commandTransport = t),
    setLinks: (l) => (links = l),
    fireDisconnect,
    removeLink,
    fireAutopilotVersion: (d) => {
      for (const cb of [...avCbs]) cb(d);
    },
  };
}

function link(id: string, isPrimary: boolean): LinkInfo {
  return { id, type: "websocket", label: id, isConnected: true, connectedAt: 1, lastByteAt: 1, isPrimary };
}

beforeEach(() => {
  useNodeRegistryStore.setState({ nodes: {}, lastUpdate: 0 });
  useDroneManager.getState().clear();
});

describe("drone-manager multi-link lifecycle", () => {
  it("keeps the drone when its first transport closes while another link is alive (GC-02)", async () => {
    const c = await controlledProtocol();
    const t1 = testTransport();
    const t2 = testTransport();
    const lost = vi.fn();
    const unsub = onUnexpectedDisconnect(lost);
    useDroneManager.getState().addDrone("fc:a", "A", c.protocol, t1, c.vehicleInfo, {
      type: "websocket",
      url: "ws://192.168.1.50:5760",
    });

    // The adapter dropped t1 and still holds t2.
    c.setCommandTransport(t2);
    t1.emitClose();

    const drone = useDroneManager.getState().drones.get("fc:a");
    expect(drone).toBeDefined();
    expect(drone?.transport).toBe(t2);
    expect(lost).not.toHaveBeenCalled();

    // The last link goes: the protocol reports the loss.
    c.setConnected(false);
    t2.emitClose();
    expect(useDroneManager.getState().drones.has("fc:a")).toBe(true);
    c.fireDisconnect();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(useDroneManager.getState().drones.has("fc:a")).toBe(false);
    unsub();
  });

  it("does not report a replaced session as an unexpected disconnect (GC-10)", async () => {
    const first = await controlledProtocol();
    const second = await controlledProtocol();
    const lost = vi.fn();
    const unsub = onUnexpectedDisconnect(lost);
    const meta = { type: "websocket" as const, url: "ws://192.168.1.50:5760" };
    useDroneManager.getState().addDrone("fc:a", "A", first.protocol, testTransport(), first.vehicleInfo, meta);
    useDroneManager.getState().addDrone("fc:a", "A", second.protocol, testTransport(), second.vehicleInfo, meta);
    expect(lost).not.toHaveBeenCalled();
    const stored = useDroneManager.getState().drones.get("fc:a")?.protocol;
    expect(stored && unguardedProtocol(stored)).toBe(second.protocol);
    unsub();
  });

  it("treats removing the last link as an operator disconnect", async () => {
    const c = await controlledProtocol();
    c.setLinks([link("l1", true)]);
    const lost = vi.fn();
    const unsub = onUnexpectedDisconnect(lost);
    useDroneManager.getState().addDrone("fc:a", "A", c.protocol, testTransport(), c.vehicleInfo, {
      type: "websocket",
      url: "ws://192.168.1.50:5760",
    });
    await useDroneManager.getState().detachLinkFromDrone("fc:a", "l1");
    expect(lost).not.toHaveBeenCalled();
    expect(useDroneManager.getState().drones.has("fc:a")).toBe(false);
    unsub();
  });

  it("removes a secondary link through the protocol and keeps the drone", async () => {
    const c = await controlledProtocol();
    c.setLinks([link("l1", true), link("l2", false)]);
    useDroneManager.getState().addDrone("fc:a", "A", c.protocol, testTransport(), c.vehicleInfo, {
      type: "websocket",
      url: "ws://192.168.1.50:5760",
    });
    await useDroneManager.getState().detachLinkFromDrone("fc:a", "l2");
    expect(c.removeLink).toHaveBeenCalledWith("l2");
    expect(useDroneManager.getState().drones.has("fc:a")).toBe(true);
  });
});

describe("vehicle identity after connect (GC-16)", () => {
  it("stamps the AUTOPILOT_VERSION board id onto the reconnect identity", async () => {
    const c = await controlledProtocol();
    useDroneManager.getState().addDrone("fc:a", "A", c.protocol, testTransport(), c.vehicleInfo, {
      type: "websocket",
      url: "ws://192.168.1.50:5760",
    });
    expect(useDroneManager.getState().drones.get("fc:a")?.connectionMeta?.vehicle?.boardId).toBeUndefined();

    c.fireAutopilotVersion({
      capabilities: 0,
      flightSwVersion: (4 << 24) | (6 << 16) | (2 << 8),
      middlewareSwVersion: 0,
      osSwVersion: 0,
      boardVersion: 140 << 16,
      boardId: 140,
      uid: 0,
    });

    const drone = useDroneManager.getState().drones.get("fc:a");
    expect(drone?.connectionMeta?.vehicle?.boardId).toBe(140);
    expect(drone?.vehicleInfo.boardId).toBe(140);
    expect(drone?.vehicleInfo.firmwareVersionString).toBe("4.6.2");
  });
});
