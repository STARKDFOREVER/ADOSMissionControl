/**
 * ADOS Agent install catalog for the Flash Tool.
 *
 * Serves the embedded per-board catalog. There is no remote fetch: every
 * curl command runs the installer script from `main`, which fetches signed
 * release binaries, so the catalog itself carries no release pin.
 *
 * The response carries `source: "embedded"`.
 *
 * @license GPL-3.0-only
 */

import { NextResponse } from "next/server";

import { EMBEDDED_CATALOG } from "./embedded-catalog";

export async function GET() {
  return NextResponse.json({ ...EMBEDDED_CATALOG, source: "embedded" });
}
