/**
 * Server-side proxy for flight-controller firmware downloads.
 *
 * Bypasses CORS when the browser fetches firmware files from the ArduPilot
 * and Betaflight build servers or a GitHub release. The URL and every
 * redirect hop are allowlisted (https only, no userinfo or port), and the
 * body is streamed back under a byte ceiling instead of buffered.
 *
 * @license GPL-3.0-only
 */

import { NextRequest, NextResponse } from "next/server";

import {
  AllowlistedFetchError,
  fetchAllowlisted,
  type AllowRule,
} from "@/lib/server/allowlisted-fetch";

export const runtime = "nodejs";

const FIRMWARE_ALLOW: readonly AllowRule[] = [
  { host: "firmware.ardupilot.org" },
  { host: "build.betaflight.com" },
  { host: "github.com", path: /^\/[^/]+\/[^/]+\/releases\/download\/.+$/ },
  { host: "objects.githubusercontent.com" },
  // GitHub now redirects release downloads to this CDN host.
  { host: "release-assets.githubusercontent.com" },
];
const MAX_FIRMWARE_BYTES = 32 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 120_000;

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing 'url' parameter" }, { status: 400 });
  }
  if (!URL.canParse(url)) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    const res = await fetchAllowlisted(url, {
      allow: FIRMWARE_ALLOW,
      maxBytes: MAX_FIRMWARE_BYTES,
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      signal: request.signal,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    };
    const length = res.headers.get("content-length");
    if (length) headers["Content-Length"] = length;
    return new NextResponse(res.body, { status: 200, headers });
  } catch (err) {
    if (err instanceof AllowlistedFetchError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
