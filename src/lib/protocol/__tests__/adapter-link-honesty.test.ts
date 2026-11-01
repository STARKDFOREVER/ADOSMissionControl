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

function autopilotVersion(boardVersion: number): Uint8Array {
  const payload = new Uint8Array(78);
  const view = new DataView(payload.buffer);
  view.setUint32(16, (1 << 24) | (2 << 16) | (3 << 8), true);
  view.setUint32(28, boardVersion, true);
  return buildFrame(148, payload, 1, 1, 0);
}

function acflyK9BatteryStatus(): Uint8Array {
  const payload = new Uint8Array(72);
  const view = new DataView(payload.buffer);
  view.setUint32(0, 252, true); // 25.2 V
  view.setUint32(4, 12000, true);
  view.setUint32(8, 7, true);
  view.setUint16(12, 0, true);
  view.setInt16(14, 25, true);
  view.setUint16(16, 10, true);
  view.setInt16(18, 123, true); // 12.3 A
  view.setUint8(20, 2);
  view.setUint8(21, 95);
  view.setUint8(22, 80);
  view.setUint8(23, 6);
  return buildFrame(602, payload, 1, 1, 0);
}

function acflyK9EscTelemetry(): Uint8Array {
  const payload = new Uint8Array(48);
  const view = new DataView(payload.buffer);
  view.setUint16(0, 80, true);
  view.setUint8(4, 80);
  view.setUint8(5, 1);
  view.setUint16(6, 0, true);
  view.setUint32(8, 9000, true);
  view.setFloat32(12, 22.5, true);
  view.setFloat32(16, 8.25, true);
  view.setInt16(20, 300, true);
  view.setInt16(22, 280, true);
  return buildFrame(500, payload, 1, 1, 0);
}

function acflyK9PayloadTelemetry(): Uint8Array {
  const payload = new Uint8Array(48);
  const view = new DataView(payload.buffer);
  view.setUint16(0, 81, true);
  view.setUint8(4, 81);
  view.setUint8(5, 2);
  view.setUint32(6, 1, true); // hook locked
  view.setUint16(10, 75, true); // 7.5 kg
  view.setInt16(16, -12, true);
  return buildFrame(500, payload, 1, 1, 0);
}

function acflyK9MissionCurrent(): Uint8Array {
  const payload = new Uint8Array(38);
  const view = new DataView(payload.buffer);
  view.setUint16(0, 9, true);
  view.setUint16(2, 6, true);
  view.setFloat32(22, 24.5, true);
  view.setFloat32(26, 3.5, true);
  view.setFloat32(30, 7.25, true);
  view.setFloat32(34, 10, true);
  return buildFrame(42, payload, 1, 1, 0);
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

describe("firmware identification", () => {
  it("switches the active firmware handler when AUTOPILOT_VERSION identifies an ACFly K9", async () => {
    const { adapter, link } = await connected();
    expect(adapter.getFirmwareHandler()?.firmwareType).toBe("ardupilot-copter");
    let callbackFirmwareType: string | undefined;
    adapter.onAutopilotVersion(() => {
      callbackFirmwareType = adapter.getVehicleInfo()?.firmwareType;
    });

    link.emit(autopilotVersion(5));

    expect(adapter.getFirmwareHandler()?.firmwareType).toBe("acfly-k9");
    expect(callbackFirmwareType).toBe("acfly-k9");
    expect(adapter.getVehicleInfo()).toMatchObject({
      firmwareType: "acfly-k9",
      firmwareVersionString: "1.2.3",
    });
  });

  it("does not reclassify other board versions as ACFly K9", async () => {
    const { adapter, link } = await connected();

    link.emit(autopilotVersion(4));

    expect(adapter.getFirmwareHandler()?.firmwareType).toBe("ardupilot-copter");
    expect(adapter.getVehicleInfo()?.firmwareType).toBe("ardupilot-copter");
  });

  it("routes ACFly K9 battery telemetry into the shared battery callback", async () => {
    const { adapter, link } = await connected();
    const batteries: unknown[] = [];
    adapter.onBattery((data) => batteries.push(data));
    link.emit(autopilotVersion(5));

    link.emit(acflyK9BatteryStatus());

    expect(batteries).toHaveLength(1);
    expect(batteries[0]).toMatchObject({
      id: 2,
      voltage: 25.2,
      current: 12.3,
      remaining: 80,
      temperature: 25,
    });
  });

  it("routes ACFly K9 component-extension ESC messages to the dedicated callback", async () => {
    const { adapter, link } = await connected();
    const esc: unknown[] = [];
    adapter.onACFlyK9EscTelemetry((data) => esc.push(data));
    link.emit(autopilotVersion(5));

    link.emit(acflyK9EscTelemetry());

    expect(esc).toHaveLength(1);
    expect(esc[0]).toMatchObject({
      motorId: 1,
      rpm: 9000,
      voltage: 22.5,
      current: 8.25,
      escTemperature: 30,
      motorTemperature: 28,
    });
  });

  it("routes ACFly K9 component-extension payload messages to their dedicated callback", async () => {
    const { adapter, link } = await connected();
    const payloadTelemetry: unknown[] = [];
    adapter.onACFlyK9PayloadTelemetry((data) => payloadTelemetry.push(data));
    link.emit(autopilotVersion(5));

    link.emit(acflyK9PayloadTelemetry());

    expect(payloadTelemetry).toHaveLength(1);
    expect(payloadTelemetry[0]).toMatchObject({
      moduleId: 2,
      hookLocked: true,
      cargoWeightKg: 7.5,
      speedCmPerSecond: -12,
    });
  });

  it("routes extended MISSION_CURRENT fields only to the ACFly K9 callback", async () => {
    const { adapter, link } = await connected();
    const reports: unknown[] = [];
    adapter.onACFlyK9MissionCurrent((data) => reports.push(data));
    link.emit(autopilotVersion(5));

    link.emit(acflyK9MissionCurrent());

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      seq: 9,
      resumeSeq: 6,
      distance: 24.5,
      triggerInterval: 3.5,
      speed: 7.25,
      radius: 10,
    });
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
