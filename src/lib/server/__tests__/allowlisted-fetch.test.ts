// @vitest-environment node
/**
 * The allowlisted fetch admits only https locations on its rules, re-checks
 * every redirect hop, and caps the streamed body.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  AllowlistedFetchError,
  fetchAllowlisted,
  isAllowedUrl,
  readAllowlistedBody,
  type AllowRule,
} from "../allowlisted-fetch";

const ALLOW: AllowRule[] = [
  { host: "files.example.com" },
  { host: "github.com", path: /^\/[^/]+\/[^/]+\/releases\/download\/.+$/ },
];
const OPTS = { allow: ALLOW, maxBytes: 16, timeoutMs: 5_000 };

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function rejection(p: Promise<unknown>): Promise<AllowlistedFetchError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AllowlistedFetchError);
  return err as AllowlistedFetchError;
}

describe("isAllowedUrl", () => {
  it("admits https on an allowed host and a matching path", () => {
    expect(isAllowedUrl(new URL("https://files.example.com/a.bin"), ALLOW)).toBe(true);
    expect(
      isAllowedUrl(new URL("https://github.com/o/r/releases/download/v1/fw.px4"), ALLOW),
    ).toBe(true);
  });

  it("refuses http, userinfo, an explicit port and an unmatched path", () => {
    expect(isAllowedUrl(new URL("http://files.example.com/a.bin"), ALLOW)).toBe(false);
    const withUserinfo = new URL("https://files.example.com/a.bin");
    withUserinfo.username = "u";
    withUserinfo.password = "p";
    expect(isAllowedUrl(withUserinfo, ALLOW)).toBe(false);
    expect(isAllowedUrl(new URL("https://files.example.com:8443/a.bin"), ALLOW)).toBe(false);
    expect(isAllowedUrl(new URL("https://github.com/o/r/archive/main.zip"), ALLOW)).toBe(false);
    expect(isAllowedUrl(new URL("https://evil.example.com/a.bin"), ALLOW)).toBe(false);
  });
});

describe("fetchAllowlisted", () => {
  it("refuses an off-list URL without fetching", async () => {
    const err = await rejection(fetchAllowlisted("http://files.example.com/a", OPTS));
    expect(err.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops at a redirect hop off the allowlist", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://192.168.1.50/x" } }),
    );
    const err = await rejection(fetchAllowlisted("https://files.example.com/a", OPTS));
    expect(err.code).toBe("not_allowed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe("manual");
  });

  it("follows an allowed redirect and returns the body", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://github.com/o/r/releases/download/v1/a" },
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const res = await fetchAllowlisted("https://files.example.com/a", OPTS);
    expect(new Uint8Array(await readAllowlistedBody(res))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("refuses an oversized Content-Length before reading", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("x".repeat(32), { status: 200, headers: { "content-length": "32" } }),
    );
    const err = await rejection(fetchAllowlisted("https://files.example.com/a", OPTS));
    expect(err.status).toBe(413);
  });

  it("errors a chunked body once it crosses the ceiling", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(10));
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
    const res = await fetchAllowlisted("https://files.example.com/a", OPTS);
    const err = await rejection(readAllowlistedBody(res));
    expect(err.code).toBe("too_large");
    expect(pulled).toBeLessThan(6);
  });

  it("maps an upstream error status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    const err = await rejection(fetchAllowlisted("https://files.example.com/a", OPTS));
    expect(err.status).toBe(404);
  });
});
