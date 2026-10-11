/**
 * The agent surfaces Mission Control reads after the command-path and
 * transport changes: detector selection through a 202 download, the
 * diagnostics block on the consolidated status, the 422 config refusals,
 * and the unpaired node's PIN-session ticket flow.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { selectDetectorInstalling } from "@/lib/agent/vision-detector-select";
import { VisionAgentClient } from "@/lib/agent/vision-client";
import { parseAgentDiagnostics } from "@/lib/agent/agent-diagnostics";
import { configWriteFailure, configWriteRefusalBody } from "@/lib/agent/config-write";
import {
  dashboardSessionFor,
  forgetDashboardSession,
  verifyDashboardPin,
} from "@/lib/agent/local-pair/dashboard-session";
import { dashboardPinLockCopy } from "@/lib/agent/local-pair/dashboard-pin";
import { detectionsAvailability } from "@/lib/agent/vision-detections-ws";
import { mintWsTicket } from "@/lib/api/ground-station/ws-ticket";
import { DEMO_STATUS_EXTRAS } from "@/mock/agent/status-extras";

const HOST = "http://192.168.1.50:8080";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("selectDetectorInstalling", () => {
  it("downloads a model the node lacks, polls until installed, then selects it", async () => {
    const putDetector = vi
      .fn()
      .mockResolvedValueOnce({ status: "error", message: "not installed", notInstalled: true })
      .mockResolvedValueOnce({ status: "ok", message: "set", modelId: "yolo" });
    const download = vi.fn().mockResolvedValue({
      status: "ok",
      message: "",
      statusUrl: "/api/vision/models/yolo/status",
    });
    const modelStatus = vi
      .fn()
      .mockResolvedValueOnce({ installed: false, download: { state: "downloading" } })
      .mockResolvedValueOnce({ installed: true, download: null });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const res = await selectDetectorInstalling({ putDetector, download, modelStatus }, "yolo", sleep);
    expect(res).toEqual({ status: "ok", message: "set", modelId: "yolo" });
    expect(download).toHaveBeenCalledWith("yolo");
    expect(modelStatus).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("stops on a failed download without selecting", async () => {
    const putDetector = vi
      .fn()
      .mockResolvedValue({ status: "error", message: "", notInstalled: true });
    const res = await selectDetectorInstalling(
      {
        putDetector,
        download: vi.fn().mockResolvedValue({ status: "ok", message: "" }),
        modelStatus: vi.fn().mockResolvedValue({ installed: false, download: { state: "error" } }),
      },
      "yolo",
      vi.fn().mockResolvedValue(undefined),
    );
    expect(res.status).toBe("error");
    expect(putDetector).toHaveBeenCalledTimes(1);
  });
});

describe("VisionAgentClient.download", () => {
  let fetchMock: Mock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a 202 started answer as ok with its status URL", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { status: "started", model_id: "yolo", status_url: "/api/vision/models/yolo/status" },
        202,
      ),
    );
    const res = await new VisionAgentClient(HOST).download("yolo");
    expect(res.status).toBe("ok");
    expect(res.statusUrl).toBe("/api/vision/models/yolo/status");
  });
});

describe("parseAgentDiagnostics", () => {
  it("reads the demo node's command-path block", () => {
    const d = parseAgentDiagnostics(DEMO_STATUS_EXTRAS);
    expect(d.fcSystemId).toBe(1);
    expect(d.fcIdentity?.outcome).toBe("disabled");
    expect(d.proxy).toEqual({ tcp: true, udp: [true, true], ws: true });
    expect(d.unsignedRejectedRisk).toBe(false);
    expect(d.swarmPrecedence).toBe("operator");
  });

  it("reads absent keys as null, never as healthy", () => {
    const d = parseAgentDiagnostics({});
    expect(d.fcSystemId).toBeNull();
    expect(d.proxy).toBeNull();
    expect(d.unsignedRejectedRisk).toBeNull();
    expect(d.encoderForcedSoftware).toBeNull();
    expect(d.auxUplinkQueueFullDropped).toBeNull();
  });
});

describe("config write refusals", () => {
  it("shows the cross-field rule's message for 422 E_INVALID", () => {
    const body = {
      error: "E_INVALID",
      field: "mavlink.injector_arbitration",
      message: "injector arbitration needs the pilot-in-command arbiter",
    };
    expect(configWriteRefusalBody(body)).toBe(body);
    expect(configWriteFailure(body)).toBe(
      "mavlink.injector_arbitration: injector arbitration needs the pilot-in-command arbiter",
    );
  });

  it("flattens the schema messages of a 422 E_VALIDATION", () => {
    const body = { code: "E_VALIDATION", key: "video.bitrate", messages: ["must be at most 20000"] };
    expect(configWriteRefusalBody(body)).toBe(body);
    expect(configWriteFailure(body)).toBe("video.bitrate: must be at most 20000");
  });
});

describe("unpaired ground-station ticket flow", () => {
  let fetchMock: Mock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    forgetDashboardSession(HOST);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dials with no ticket when neither a key nor a PIN session is held", async () => {
    expect(await mintWsTicket({ baseUrl: HOST, apiKey: null }, "gs.uplink_events")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints the ticket under the PIN session once the operator unlocked", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, session: "sess-1", expires_at: Date.now() / 1000 + 600 }),
    );
    await verifyDashboardPin(HOST, "1234");
    expect(dashboardSessionFor(HOST)).toBe("sess-1");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, ticket: "t-1", scope: "gs.uplink_events", expires_at: 0 }),
    );
    const ticket = await mintWsTicket({ baseUrl: HOST, apiKey: null }, "gs.uplink_events");
    expect(ticket).toBe("t-1");
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${HOST}/api/_ws/ticket`);
    const headers = init.headers as Record<string, string>;
    expect(headers["X-ADOS-Dashboard-Session"]).toBe("sess-1");
    expect(headers["X-ADOS-Key"]).toBeUndefined();
  });

  it("names a node-wide PIN lock", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "E_PIN_LOCKED", scope: "node", retry_after_s: 1200 }, 423),
    );
    await expect(verifyDashboardPin(HOST, "0000")).rejects.toThrow(/locked for every device/);
    expect(dashboardSessionFor(HOST)).toBeNull();
    expect(
      dashboardPinLockCopy({ locked: true, lockedUntil: 1_000_600, lockScope: "node" }, 1_000_000),
    ).toMatch(/every device for 10 min/);
  });
});

describe("detectionsAvailability", () => {
  it("separates vision off from nothing detected", () => {
    expect(detectionsAvailability({ detections: [], available: false })).toBe(false);
    expect(detectionsAvailability({ detections: [], available: true })).toBe(true);
    expect(detectionsAvailability({ detections: [] })).toBeNull();
  });
});
