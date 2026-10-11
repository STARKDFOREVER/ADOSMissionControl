// @vitest-environment node
/**
 * The AI tuning route bounds the upstream call, charges quota only for a
 * delivered answer, and serves only the local network without accounts.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { POST } from "../route";

vi.mock("convex/nextjs", () => ({ fetchMutation: vi.fn(), fetchQuery: vi.fn() }));

const BODY = { vehicleType: "copter", currentParams: { ATC_RAT_RLL_P: 0.135 } };
const GOOD_ANSWER = {
  choices: [{ message: { content: JSON.stringify({ recommendations: [], summary: "ok" }) } }],
};

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GROQ_API_KEY", "test-key");
  vi.mocked(fetchQuery).mockReset();
  vi.mocked(fetchMutation).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function post(host: string, body: unknown = BODY, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", host };
  if (cookie) headers.cookie = cookie;
  return POST(
    new NextRequest(`http://${host}/api/pid-analysis`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("pid-analysis without accounts", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", ""));

  it("refuses a public host", async () => {
    const res = await post("gcs.example.com");
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves a LAN host", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(GOOD_ANSWER), { status: 200 }));
    const res = await post("192.168.1.50:4000");
    expect(res.status).toBe(200);
    expect((await res.json()).summary).toBe("ok");
  });

  it("refuses a body over 1 MB", async () => {
    const res = await post("192.168.1.50:4000", "x".repeat(1024 * 1024 + 1));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 504 when the upstream stalls past the timeout", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
        const { promise, reject } = Promise.withResolvers<Response>();
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
        return promise;
      });
      const pending = post("192.168.1.50:4000");
      await vi.advanceTimersByTimeAsync(30_001);
      expect((await pending).status).toBe(504);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pid-analysis with accounts", () => {
  const COOKIE = "__convexAuthJWT=tok";

  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://cloud.example.com"));

  it("answers 429 at zero remaining without calling upstream", async () => {
    vi.mocked(fetchQuery).mockResolvedValueOnce({ remaining: 0, weeklyLimit: 3, usedThisWeek: 3 });
    const res = await post("localhost:4000", BODY, COOKIE);
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("does not record usage when the upstream fails", async () => {
    vi.mocked(fetchQuery).mockResolvedValueOnce({ remaining: 2, weeklyLimit: 3, usedThisWeek: 1 });
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const res = await post("localhost:4000", BODY, COOKIE);
    expect(res.status).toBe(502);
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("records usage after a delivered answer", async () => {
    vi.mocked(fetchQuery).mockResolvedValueOnce({ remaining: 2, weeklyLimit: 3, usedThisWeek: 1 });
    vi.mocked(fetchMutation).mockResolvedValueOnce({ recorded: true, remaining: 1, weeklyLimit: 3 });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(GOOD_ANSWER), { status: 200 }));
    const res = await post("localhost:4000", BODY, COOKIE);
    expect(res.status).toBe(200);
    expect(fetchMutation).toHaveBeenCalledTimes(1);
    expect((await res.json()).remaining).toBe(1);
  });
});
