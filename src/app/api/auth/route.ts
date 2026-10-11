import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { fetchAction } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

import { authCookieConfig, type AuthCookieConfig } from "./cookie-config";

/**
 * Route handler that proxies auth actions (signIn/signOut) to Convex backend.
 *
 * This replaces the middleware-based proxy from @convex-dev/auth which doesn't
 * work with Next.js 16's proxy.ts convention. The logic is a faithful port of
 * `proxyAuthActionToConvex` from @convex-dev/auth/dist/nextjs/server/proxy.js.
 */

function jsonResponse(body: unknown, status = 200) {
  return new NextResponse(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function setAuthCookies(
  response: NextResponse,
  config: AuthCookieConfig,
  tokens: { token: string; refreshToken: string } | null,
) {
  const opts = {
    secure: config.secure,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
  };

  if (tokens === null) {
    response.cookies.set(config.tokenName, "", {
      ...opts,
      maxAge: undefined,
      expires: 0,
    });
    response.cookies.set(config.refreshTokenName, "", {
      ...opts,
      maxAge: undefined,
      expires: 0,
    });
  } else {
    response.cookies.set(config.tokenName, tokens.token, opts);
    response.cookies.set(config.refreshTokenName, tokens.refreshToken, opts);
  }
}

function isCorsRequest(request: NextRequest): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const originURL = new URL(origin);
  return (
    originURL.host !== request.headers.get("Host") ||
    originURL.protocol !== new URL(request.url).protocol
  );
}

function sanitizeAuthError(msg: string): string {
  if (msg.includes("InvalidSecret")) return "Incorrect password. Please try again.";
  if (msg.includes("InvalidAccountId") || msg.includes("Could not find")) return "No account found with this email.";
  if (msg.includes("TooManyFailedAttempts")) return "Too many failed attempts. Try again later.";
  if (msg.includes("already exists") || msg.includes("UNIQUE")) return "An account with this email already exists.";
  return "Authentication failed. Please try again.";
}

export async function POST(request: NextRequest) {
  // CORS check — reject cross-origin requests
  if (isCorsRequest(request)) {
    return new Response("Invalid origin", { status: 403 });
  }

  let action: unknown;
  let args: Record<string, unknown> & { params?: { code?: unknown } };
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error("body is not an object");
    }
    const raw = body as { action?: unknown; args?: unknown };
    if (typeof raw.args !== "object" || raw.args === null || Array.isArray(raw.args)) {
      throw new Error("args is not an object");
    }
    action = raw.action;
    args = raw.args as typeof args;
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  if (action !== "auth:signIn" && action !== "auth:signOut") {
    return new Response("Invalid action", { status: 400 });
  }

  // Read existing auth cookies
  const config = authCookieConfig(request);
  let token: string | undefined;

  if (action === "auth:signIn" && args.refreshToken !== undefined) {
    // The client has a dummy refreshToken, the real one is only stored in cookies
    const refreshToken = request.cookies.get(config.refreshTokenName)?.value ?? null;
    if (refreshToken === null) {
      console.error(
        "Convex Auth: Unexpected missing refreshToken cookie during client refresh",
      );
      return jsonResponse({ tokens: null });
    }
    args.refreshToken = refreshToken;
  } else {
    // Make sure the proxy is authenticated if the client is,
    // important for signOut and any other logic working with existing sessions
    token = request.cookies.get(config.tokenName)?.value ?? undefined;
  }

  if (action === "auth:signIn") {
    // Do not require auth when refreshing tokens or validating a code
    // since they are steps in the auth flow
    const fetchActionAuthOptions =
      args.refreshToken !== undefined || args.params?.code !== undefined
        ? {}
        : { token };

    let result;
    try {
      result = await fetchAction(
        makeFunctionReference<"action">(action),
        args,
        fetchActionAuthOptions,
      );
    } catch (error: unknown) {
      console.error("Hit error while running `auth:signIn`:");
      console.error(error);
      const response = jsonResponse(
        { error: sanitizeAuthError(error instanceof Error ? error.message : "") },
        400,
      );
      setAuthCookies(response, config, null);
      return response;
    }

    if (result.redirect !== undefined) {
      return jsonResponse({ redirect: result.redirect });
    } else if (result.tokens !== undefined) {
      // The server doesn't share the refresh token with the client
      // for added security — the client has to use the server
      // to refresh the access token via cookies
      const response = jsonResponse({
        tokens:
          result.tokens !== null
            ? { token: result.tokens.token, refreshToken: "dummy" }
            : null,
      });
      setAuthCookies(response, config, result.tokens);
      return response;
    }

    return jsonResponse(result);
  } else {
    // auth:signOut
    try {
      await fetchAction(makeFunctionReference<"action">(action), args, { token });
    } catch (error) {
      console.error("Hit error while running `auth:signOut`:");
      console.error(error);
    }
    const response = jsonResponse(null);
    setAuthCookies(response, config, null);
    return response;
  }
}
