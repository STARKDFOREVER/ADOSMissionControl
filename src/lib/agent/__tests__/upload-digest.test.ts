/**
 * The streaming uploads declare their body digest, and the agent's upload
 * refusals reach the operator as copy, not a bare status code.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { contentDigestHeader, uploadRefusalCopy } from "@/lib/agent/upload-digest";
import { PluginAgentClient, PluginAgentError } from "@/lib/agent/plugin-client";
import { VisionAgentClient, VisionAgentError } from "@/lib/agent/vision-client";

// sha256("abc")
const ABC_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("contentDigestHeader", () => {
  it("is the lowercase hex sha256 of the file bytes", async () => {
    const header = await contentDigestHeader(new Blob(["abc"]));
    expect(header).toEqual({ "X-Content-SHA256": ABC_SHA256 });
  });
});

describe("uploadRefusalCopy", () => {
  it("names the busy slot and the digest mismatch", () => {
    expect(uploadRefusalCopy(429, { error: "E_BUSY" })).toMatch(/Another install is running/);
    expect(uploadRefusalCopy(401, { error: "E_DIGEST_MISMATCH" })).toMatch(/checksum mismatch/);
    expect(uploadRefusalCopy(401, { error: "E_AUTH" })).toBeNull();
    expect(uploadRefusalCopy(500, null)).toBeNull();
  });
});

describe("plugin uploads", () => {
  it("sends X-Content-SHA256 on install and parse", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = new PluginAgentClient("http://192.168.1.50:8080", "k", fetchImpl);
    const file = new File(["abc"], "p.adosplug");
    await client.install(file);
    await client.parseArchive(file);
    for (const call of fetchImpl.mock.calls) {
      const headers = (call[1] as RequestInit).headers as Record<string, string>;
      expect(headers["X-Content-SHA256"]).toBe(ABC_SHA256);
      expect(headers["X-ADOS-Key"]).toBe("k");
    }
  });

  it("maps 429 E_BUSY to the install-running copy", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: "E_BUSY", message: "another install is running" }, 429),
    );
    const client = new PluginAgentClient("http://192.168.1.50:8080", "", fetchImpl);
    const err = await client.parseArchive(new File(["abc"], "p.adosplug")).catch((e) => e);
    expect(err).toBeInstanceOf(PluginAgentError);
    expect((err as PluginAgentError).kind).toBe("busy");
    expect((err as Error).message).toMatch(/Another install is running/);
  });
});
describe("vision model upload", () => {
  let fetchMock: Mock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const meta = {
    name: "m",
    classes: [],
    head: "yolov8",
    inputWidth: 640,
    inputHeight: 640,
    runtime: "onnx",
    boardMatch: [],
  };

  it("sends the digest and maps a mismatch to copy", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "E_DIGEST_MISMATCH" }, 401));
    const client = new VisionAgentClient("http://192.168.1.50:8080", "k");
    const err = await client.uploadModel(new File(["abc"], "m.onnx"), meta).catch((e) => e);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Content-SHA256"]).toBe(ABC_SHA256);
    expect(err).toBeInstanceOf(VisionAgentError);
    expect((err as Error).message).toMatch(/checksum mismatch/);
  });
});
