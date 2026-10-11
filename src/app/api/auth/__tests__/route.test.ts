// @vitest-environment node
/**
 * Auth cookies follow the effective protocol, so a plain-http LAN self-host
 * gets cookies the browser stores, and a malformed body is a 400.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fetchAction } from "convex/nextjs";
import { POST } from "../route";
import { authCookieConfig } from "../cookie-config";

vi.mock("server-only", () => ({}));
vi.mock("convex/nextjs", () => ({ fetchAction: vi.fn() }));

function req(url: string, body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", host: new URL(url).host, ...headers },
    body,
  });
}

beforeEach(() => {
  vi.mocked(fetchAction).mockReset();
});

describe("authCookieConfig", () => {
  it("uses plain unprefixed cookies on an http LAN host", () => {
    const c = authCookieConfig(req("http://192.168.1.50:4000/api/auth", "{}"));
    expect(c).toEqual({
      tokenName: "__convexAuthJWT",
      refreshTokenName: "__convexAuthRefreshToken",
      secure: false,
    });
  });

  it("uses Secure __Host- cookies behind a TLS proxy", () => {
    const c = authCookieConfig(
      req("http://gcs.example.com/api/auth", "{}", { "x-forwarded-proto": "https" }),
    );
    expect(c.secure).toBe(true);
    expect(c.tokenName).toBe("__Host-__convexAuthJWT");
  });

  it("treats loopback as plain even over https", () => {
    expect(authCookieConfig(req("https://localhost:4000/api/auth", "{}")).secure).toBe(false);
  });
});

describe("POST /api/auth", () => {
  it("answers 400 to a non-JSON body", async () => {
    const res = await POST(req("http://192.168.1.50:4000/api/auth", "not json"));
    expect(res.status).toBe(400);
  });

  it("answers 400 when args is missing", async () => {
    const res = await POST(
      req("http://192.168.1.50:4000/api/auth", JSON.stringify({ action: "auth:signIn" })),
    );
    expect(res.status).toBe(400);
    expect(fetchAction).not.toHaveBeenCalled();
  });

  it("sets non-Secure unprefixed cookies on an http LAN sign-in", async () => {
    vi.mocked(fetchAction).mockResolvedValueOnce({ tokens: { token: "t", refreshToken: "r" } });
    const res = await POST(
      req(
        "http://192.168.1.50:4000/api/auth",
        JSON.stringify({ action: "auth:signIn", args: { provider: "password" } }),
      ),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toContain("__convexAuthJWT=t");
    expect(setCookie).not.toContain("__Host-");
    expect(setCookie.toLowerCase()).not.toContain("secure");
  });
});
