/**
 * @module protocol/adapter-link-honesty.test
 * @description MAVLinkAdapter behaviour on links that refuse, drop or lie:
 *
 * - command refusals and send failures are reported at once, not as timeouts;
 * - stream rates are requested on connect, link restore and FC reboot only,
 *   and never when the operator turned GCS rate management off;
 * - the protocol (not one transport) reports the loss of its last link;
 * - inbound signatures are counted per link and enforcement drops unsigned frames;
 * - a vehicle's MISSION_ACK error ends a download with its reason;
 * - a transfer whose opening send throws leaves no slot or timer armed;
 * - per-frame diagnostics logging runs only while a diagnostics surface is mounted.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { MAVLinkAdapter } from "../mavlink-adapter";
import { buildFrame } from "../encoders/frame";
import { MavlinkSigner } from "../mavlink-signer";
import { RECEIVE_ONLY_REFUSAL } from "../command-refusal";
import { DEFAULT_BRIDGE_URL } from "../transport/net-mavlink";
import type { Transport, TransportEventMap } from "../types";
import { useSettingsStore } from "@/stores/settings-store";
import { useSigningStore } from "@/stores/signing-store";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";

type Handler = (data: unknown) => void;

class FakeTransport implements Transport {
  readonly type = "websocket" as const;
  isConnected = true;
  canCommand = true;
  failSends: Error | null = null;
  readonly sent: Uint8Array[] = [];
  private readonly handlers = new Map<keyof TransportEventMap, Set<Handler>>();

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {
    this.isConnected = false;
  }
  send(data: Uint8Array): void {
    if (this.failSends) throw this.failSends;
    this.sent.push(data);
  }
  on<K extends keyof TransportEventMap>(event: K, handler: (data: TransportEventMap[K]) => void): void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.handlers.set(event, set);
  }
  off<K extends keyof TransportEventMap>(event: K, handler: (data: TransportEventMap[K]) => void): void {
    this.handlers.get(event)?.delete(handler as Handler);
  }
  emit(bytes: Uint8Array): void {
    for (const h of [...(this.handlers.get("data") ?? [])]) h(bytes);
  }
  close(): void {
    this.isConnected = false;
    for (const h of [...(this.handlers.get("close") ?? [])]) h(undefined);
  }
  frames(msgId: number): Uint8Array[] {
    return this.sent.filter((f) => (f[7] | (f[8] << 8) | (f[9] << 16)) === msgId);
  }
}

const REQUEST_DATA_STREAM = 66;
const COMMAND_LONG = 76;
const MISSION_REQUEST_LIST = 43;

function heartbeat(sysId = 1, compId = 1): Uint8Array {
  const p = new Uint8Array(9);
  p[4] = 2; // MAV_TYPE_QUADROTOR
  p[5] = 3; // MAV_AUTOPILOT_ARDUPILOTMEGA
  p[7] = 4;
  p[8] = 3;
  return buildFrame(0, p, sysId, compId, 0);
}

function systemTime(bootMs: number): Uint8Array {
  const dv = new DataView(new ArrayBuffer(12));
  dv.setUint32(8, bootMs, true);
  return buildFrame(2, new Uint8Array(dv.buffer), 1, 1, 0);
}

function missionAck(type: number, missionType: number): Uint8Array {
  return buildFrame(47, new Uint8Array([255, 190, type, missionType]), 1, 1, 0);
}

const open: MAVLinkAdapter[] = [];

async function connected(link = new FakeTransport()): Promise<{ adapter: MAVLinkAdapter; link: FakeTransport }> {
  const adapter = new MAVLinkAdapter();
  open.push(adapter);
  const pending = adapter.connect(link);
  link.emit(heartbeat());
  await pending;
  return { adapter, link };
}

beforeEach(() => {
  useSettingsStore.setState({ gcsManagesTelemetryRates: true, enforceInboundSigning: false });
});

afterEach(async () => {
  vi.useRealTimers();
  for (const a of open.splice(0)) await a.disconnect();
});

describe("command path honesty", () => {
  it("returns the receive-only refusal at once and sends nothing", async () => {
    const link = new FakeTransport();
    link.canCommand = false;
    const { adapter } = await connected(link);
    const before = link.frames(COMMAND_LONG).length;
    const result = await adapter.arm();
    expect(result).toMatchObject({ success: false, message: RECEIVE_ONLY_REFUSAL });
    expect(link.frames(COMMAND_LONG).length).toBe(before);
  });

  it("fails a command at once with the transport's own reason when the send throws", async () => {
    const { adapter, link } = await connected();
    link.failSends = new Error("socket closing");
    vi.useFakeTimers();
    const result = await adapter.arm();
    expect(result.success).toBe(false);
    expect(result.message).toBe("Send failed: socket closing");
  });
});

describe("stream-rate requests", () => {
  it("requests rates once on connect and never on a timer", async () => {
    vi.useFakeTimers();
    const { link } = await connected();
    const afterConnect = link.frames(REQUEST_DATA_STREAM).length;
    expect(afterConnect).toBeGreaterThan(0);
    // Heartbeats keep the link alive across the window.
    for (let i = 0; i < 30; i++) {
      link.emit(heartbeat());
      vi.advanceTimersByTime(1000);
    }
    expect(link.frames(REQUEST_DATA_STREAM).length).toBe(afterConnect);
  });

  it("re-requests when the FC reboots (time_boot_ms goes backwards)", async () => {
    const { link } = await connected();
    link.emit(systemTime(50_000));
    const before = link.frames(REQUEST_DATA_STREAM).length;
    link.emit(systemTime(60_000));
    expect(link.frames(REQUEST_DATA_STREAM).length).toBe(before);
    link.emit(systemTime(1_200));
    expect(link.frames(REQUEST_DATA_STREAM).length).toBeGreaterThan(before);
  });

  it("re-requests when the link is restored after a loss", async () => {
    vi.useFakeTimers();
    const { link } = await connected();
    const before = link.frames(REQUEST_DATA_STREAM).length;
    vi.advanceTimersByTime(10_000); // no heartbeat: link lost
    link.emit(heartbeat());
    vi.advanceTimersByTime(1000); // link check sees the heartbeat: restored
    expect(link.frames(REQUEST_DATA_STREAM).length).toBeGreaterThan(before);
  });

  it("gcsManagesTelemetryRates_off_never_sends", async () => {
    useSettingsStore.setState({ gcsManagesTelemetryRates: false });
    const { link } = await connected();
    link.emit(systemTime(50_000));
    link.emit(systemTime(10));
    expect(link.frames(REQUEST_DATA_STREAM)).toHaveLength(0);
  });
});

describe("protocol-level disconnect", () => {
  it("fires onDisconnect only when the last link goes", async () => {
    const { adapter, link: a } = await connected();
    const b = new FakeTransport();
    const added = adapter.addLink(b);
    b.emit(heartbeat());
    expect(await added).toMatchObject({ ok: true });
    const fired = vi.fn();
    adapter.onDisconnect(fired);

    a.close();
    expect(fired).not.toHaveBeenCalled();
    expect(adapter.isConnected).toBe(true);
    expect(adapter.commandTransport).not.toBeNull();

    b.close();
    expect(fired).toHaveBeenCalledTimes(1);
    expect(adapter.isConnected).toBe(false);
  });
});

describe("inbound signing", () => {
  const key = new Uint8Array(32).fill(7);

  it("counts signed-ok, signed-bad and unsigned frames per link", async () => {
    vi.useFakeTimers();
    const { adapter, link } = await connected();
    adapter.setSigner(new MavlinkSigner("d1", 1, "k1", key));
    const good = new MavlinkSigner("d1", 2, "k1", key).signFrame(buildFrame(30, new Uint8Array(28), 1, 1, 1));
    const bad = new MavlinkSigner("d1", 2, "k2", new Uint8Array(32).fill(9)).signFrame(buildFrame(30, new Uint8Array(28), 1, 1, 2));
    link.emit(good);
    link.emit(bad);
    vi.advanceTimersByTime(1000);
    const [linkId] = adapter.linkInfo.map((l) => l.id);
    const counters = useSigningStore.getState().linkCounters[linkId];
    expect(counters.signedOk).toBe(1);
    expect(counters.signedBad).toBe(1);
    expect(counters.unsigned).toBeGreaterThanOrEqual(1); // the connect heartbeat
  });

  it("drops unsigned and badly signed frames while enforcement is on", async () => {
    const { adapter, link } = await connected();
    adapter.setSigner(new MavlinkSigner("d1", 1, "k1", key));
    useSettingsStore.setState({ enforceInboundSigning: true });
    const seen: number[] = [];
    adapter.onMavlinkFrame((f) => seen.push(f.sequence));
    link.emit(buildFrame(30, new Uint8Array(28), 1, 1, 11));
    link.emit(new MavlinkSigner("d1", 2, "k2", new Uint8Array(32).fill(9)).signFrame(buildFrame(30, new Uint8Array(28), 1, 1, 12)));
    link.emit(new MavlinkSigner("d1", 2, "k1", key).signFrame(buildFrame(30, new Uint8Array(28), 1, 1, 13)));
    expect(seen).toEqual([13]);
  });
});

describe("mission transfers", () => {
  it("ends a download with the vehicle's MISSION_ACK reason instead of stalling", async () => {
    const { adapter, link } = await connected();
    const download = adapter.downloadMission();
    expect(link.frames(MISSION_REQUEST_LIST)).toHaveLength(1);
    link.emit(missionAck(15, 0)); // MAV_MISSION_OPERATION_CANCELLED
    await expect(download).rejects.toThrow("Vehicle refused download: MAV_MISSION_RESULT 15");
  });

  it("fails a fence download whose first send throws and leaves no timer armed", async () => {
    const { adapter, link } = await connected();
    vi.useFakeTimers();
    link.failSends = new Error("relay refused");
    const timersBefore = vi.getTimerCount();
    await expect(adapter.downloadFenceMission()).rejects.toThrow("relay refused");
    expect(vi.getTimerCount()).toBe(timersBefore);
  });
});

describe("diagnostics gating", () => {
  it("diagnostics_refcount_gates_logMessage", async () => {
    const { link } = await connected();
    const original = useDiagnosticsStore.getState().logMessage;
    const logMessage = vi.fn();
    useDiagnosticsStore.setState({ logMessage });
    link.emit(buildFrame(30, new Uint8Array(28), 1, 1, 3));
    expect(logMessage).not.toHaveBeenCalled();

    const release = useDiagnosticsStore.getState().subscribeDiagnostics();
    link.emit(buildFrame(30, new Uint8Array(28), 1, 1, 4));
    expect(logMessage).toHaveBeenCalledTimes(1);

    release();
    link.emit(buildFrame(30, new Uint8Array(28), 1, 1, 5));
    expect(logMessage).toHaveBeenCalledTimes(1);
    useDiagnosticsStore.setState({ logMessage: original });
  });
});

describe("browser bridge default", () => {
  it("dials 127.0.0.1, not localhost", () => {
    expect(DEFAULT_BRIDGE_URL).toBe("ws://127.0.0.1:14551");
  });
});
