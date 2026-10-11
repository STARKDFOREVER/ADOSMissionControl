// @vitest-environment node
/**
 * The firmware proxy fetches only https firmware locations, re-checks
 * redirects, and streams the body under its ceiling.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function get(url: string): Promise<Response> {
  return GET(
    new NextRequest(`http://localhost:4000/api/firmware?url=${encodeURIComponent(url)}`),
  );
}

describe("firmware proxy", () => {
  it("refuses plain http and an explicit port", async () => {
    expect((await get("http://firmware.ardupilot.org/Copter/x.apj")).status).toBe(403);
    expect((await get("https://firmware.ardupilot.org:8443/Copter/x.apj")).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a github.com path that is not a release download", async () => {
    const res = await get("https://github.com/example/repo/archive/refs/heads/main.zip");
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a redirect off the allowlist", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://192.168.1.50/fw" } }),
    );
    const res = await get("https://github.com/example/repo/releases/download/v1/fw.px4");
    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("streams an allowed release download", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://objects.githubusercontent.com/a/b" },
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 8, 9]), { status: 200 }));
    const res = await get("https://github.com/example/repo/releases/download/v1/fw.px4");
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
  });

  it("refuses a declared size over 32 MB", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("x", {
        status: 200,
        headers: { "content-length": String(33 * 1024 * 1024) },
      }),
    );
    const res = await get("https://firmware.ardupilot.org/Copter/x.apj");
    expect(res.status).toBe(413);
  });
});
