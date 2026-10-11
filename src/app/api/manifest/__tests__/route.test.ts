// @vitest-environment node
/**
 * Concurrent cold-cache manifest requests share one upstream download.
 *
 * @license GPL-3.0-only
 */

import { gzipSync } from "zlib";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// The route keeps its cache and in-flight load in module state, so each case
// re-imports a fresh module after `vi.resetModules()`.

let fetchMock: Mock;

const MANIFEST = {
  "format-version": "1.0.0",
  firmware: [
    {
      format: "apj",
      platform: "ExampleBoard",
      url: "https://firmware.ardupilot.org/Copter/stable/ExampleBoard/arducopter.apj",
      vehicletype: "Copter",
      "mav-firmware-version": "4.5.0",
      "mav-firmware-version-type": "OFFICIAL",
      board_id: 9,
    },
    { format: "hex", platform: "ExampleBoard", url: "https://firmware.ardupilot.org/x.hex" },
  ],
};

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("manifest route", () => {
  it("makes one upstream fetch for two concurrent cold requests", async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    fetchMock.mockImplementation(async () => {
      await gate;
      return new Response(gzipSync(JSON.stringify(MANIFEST)), { status: 200 });
    });
    const { GET } = await import("../route");

    const a = GET();
    const b = GET();
    release();
    const [ra, rb] = await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = await ra.json();
    expect(body.firmwares).toHaveLength(1);
    expect(body.firmwares[0].boardId).toBe(9);
    expect(await rb.json()).toEqual(body);
  });

  it("retries upstream after a failed load", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(new Response(gzipSync(JSON.stringify(MANIFEST)), { status: 200 }));
    const { GET } = await import("../route");

    expect((await GET()).status).toBe(502);
    expect((await GET()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
