/**
 * @module RegistryArchiveRoute
 * @description Same-origin proxy that streams a published plugin archive
 * (`.adosplug`) back to the browser. The GCS-side install finalizer
 * fetches the archive to extract its built iframe bundle, but the
 * release CDN does not promise cross-origin access from an arbitrary
 * Mission Control origin, so the fetch happens server-side here and the
 * bytes are returned same-origin.
 *
 * The `url` and every redirect hop are allowlisted (an SSRF guard): a
 * GitHub release download (`github.com/<owner>/<repo>/releases/download/…`),
 * GitHub's release-asset CDN hosts, and the official ADOS registry host.
 * Redirects are followed by hand so each Location is re-checked, and the body
 * is read under a byte ceiling so a chunked answer cannot be buffered whole.
 *
 * @license GPL-3.0-only
 */

import { NextRequest, NextResponse } from "next/server";

import { OFFICIAL_PLUGIN_REGISTRY_URL } from "@/lib/config/endpoints";
import {
  AllowlistedFetchError,
  fetchAllowlisted,
  readAllowlistedBody,
  type AllowRule,
} from "@/lib/server/allowlisted-fetch";

export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_BYTES = 64 * 1024 * 1024; // 64 MB ceiling for a plugin archive.

/** `/<owner>/<repo>/releases/download/<tag>/<asset>` on github.com. */
const GITHUB_RELEASE_PATH = /^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+$/;

/** Release downloads, GitHub's release-asset CDN hosts, and the registry host. */
function archiveAllowRules(): AllowRule[] {
  const rules: AllowRule[] = [
    { host: "github.com", path: GITHUB_RELEASE_PATH },
    { host: "objects.githubusercontent.com" },
    { host: "release-assets.githubusercontent.com" },
  ];
  try {
    rules.push({ host: new URL(OFFICIAL_PLUGIN_REGISTRY_URL).hostname });
  } catch {
    // An unparsable registry URL adds no host.
  }
  return rules;
}

/** Wire error codes the install finalizer already understands. */
const ERROR_CODES: Record<AllowlistedFetchError["code"], string> = {
  not_allowed: "host_not_allowed",
  bad_redirect: "bad_redirect",
  upstream_error: "upstream_error",
  too_large: "too_large",
  timeout: "fetch_failed",
  fetch_failed: "fetch_failed",
};

function refuse(status: number, error: string, message: string): NextResponse {
  return NextResponse.json({ error, message }, { status });
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return refuse(400, "missing_url", "url query parameter is required");
  if (!URL.canParse(raw)) return refuse(400, "bad_url", "url is not a valid absolute URL");

  let buf: ArrayBuffer;
  try {
    const upstream = await fetchAllowlisted(raw, {
      allow: archiveAllowRules(),
      maxBytes: MAX_BYTES,
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      signal: req.signal,
    });
    buf = await readAllowlistedBody(upstream);
  } catch (err) {
    if (err instanceof AllowlistedFetchError) {
      return refuse(err.code === "timeout" ? 502 : err.status, ERROR_CODES[err.code], err.message);
    }
    return refuse(502, "fetch_failed", err instanceof Error ? err.message : String(err));
  }

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
