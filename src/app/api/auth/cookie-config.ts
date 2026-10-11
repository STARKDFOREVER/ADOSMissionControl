/**
 * @module api/auth/cookie-config
 * @description Names and attributes of the auth cookies, shared by every
 * route that sets or reads them.
 *
 * A `Secure` cookie (and the `__Host-` prefix, which requires `Secure`) is
 * only stored by a browser over https. The choice therefore follows the
 * effective request protocol: the first `X-Forwarded-Proto` value when a
 * proxy terminates TLS in front of the server, else the request URL's own
 * protocol. A loopback host is always treated as plain, so local development
 * behind any proxy keeps working. A LAN self-host on plain http gets plain,
 * unprefixed cookies the browser accepts.
 *
 * @license GPL-3.0-only
 */

import { isLoopbackIp } from "@/lib/agent/host-validation";

export interface AuthCookieConfig {
  tokenName: string;
  refreshTokenName: string;
  secure: boolean;
}

function isLoopbackHost(hostValue: string): boolean {
  if (!hostValue) return false;
  try {
    const host = new URL(`http://${hostValue}`).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || isLoopbackIp(host);
  } catch {
    return false;
  }
}

export function authCookieConfig(request: Request): AuthCookieConfig {
  const url = new URL(request.url);
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const protocol = forwarded ? `${forwarded.replace(/:$/, "")}:` : url.protocol;
  const host = request.headers.get("host") ?? url.host;
  const secure = protocol === "https:" && !isLoopbackHost(host);
  const prefix = secure ? "__Host-" : "";
  return {
    tokenName: `${prefix}__convexAuthJWT`,
    refreshTokenName: `${prefix}__convexAuthRefreshToken`,
    secure,
  };
}
