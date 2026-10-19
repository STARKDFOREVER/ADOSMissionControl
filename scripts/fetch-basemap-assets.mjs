#!/usr/bin/env node
/**
 * Fill `public/basemap-assets/` with what the vector basemap loads at runtime:
 *
 * - label glyphs (`fonts/<fontstack>/<range>.pbf`) and the dark/light icon
 *   sprites from protomaps/basemaps-assets, pinned to one commit;
 * - the installed MapLibre worker script from node_modules, because the
 *   bundled MapLibre cannot locate its own worker file once webpack has moved it.
 *
 * The download is skipped while the stamp file names the pinned commit. The
 * worker is copied on every run so it always matches the installed MapLibre.
 *
 * Usage: node scripts/fetch-basemap-assets.mjs [--strict]
 *   --strict   exit 1 when the assets cannot be fetched (builds); without it
 *              a failed download only warns (dev without internet).
 * @license GPL-3.0-only
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const ASSETS_REPO = "protomaps/basemaps-assets";
const ASSETS_SHA = "028c18f713baecad011301ff7a69acc39bcc2ae7";
const FONTSTACKS = [
  "Noto Sans Regular",
  "Noto Sans Medium",
  "Noto Sans Italic",
  // Labels in Devanagari-script languages use this stack.
  "Noto Sans Devanagari Regular v1",
];
const SPRITE = /^sprites\/v4\/(dark|light)(@2x)?\.(json|png)$/;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "basemap-assets");
const stampFile = join(outDir, ".stamp");
const strict = process.argv.includes("--strict");

function copyWorker() {
  const src = join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
  if (!existsSync(src)) throw new Error(`MapLibre worker not found at ${src}; run npm install`);
  mkdirSync(outDir, { recursive: true });
  copyFileSync(src, join(outDir, "maplibre-gl-worker.mjs"));
}

function wanted(path) {
  if (path === "fonts/OFL.txt") return true;
  if (SPRITE.test(path)) return true;
  const m = /^fonts\/([^/]+)\/\d+-\d+\.pbf$/.exec(path);
  return m !== null && FONTSTACKS.includes(m[1]);
}

/** Text of a NUL-terminated tar header field. */
function field(buf, start, length) {
  const end = buf.indexOf(0, start);
  return buf.toString("utf8", start, end === -1 || end > start + length ? start + length : end);
}

/** Path override from a pax extended header block, if it carries one. */
function paxPath(body) {
  let at = 0;
  while (at < body.length) {
    const space = body.indexOf(0x20, at);
    if (space === -1) break;
    const len = Number(body.toString("utf8", at, space));
    if (!Number.isFinite(len) || len <= 0) break;
    const record = body.toString("utf8", space + 1, at + len - 1);
    if (record.startsWith("path=")) return record.slice(5);
    at += len;
  }
  return null;
}

/** Walk a ustar/pax archive, calling `onFile(path, bytes)` for each regular file. */
function untar(tar, onFile) {
  let offset = 0;
  let longName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = field(header, 0, 100);
    const size = parseInt(field(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 0x30);
    const prefix = field(header, 345, 155);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === "x") {
      longName = paxPath(body);
      continue;
    }
    if (type === "L") {
      longName = field(body, 0, body.length);
      continue;
    }
    if (type === "g") continue;
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    if (type === "0") onFile(path, body);
  }
}

async function fetchAssets() {
  const url = `https://codeload.github.com/${ASSETS_REPO}/tar.gz/${ASSETS_SHA}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
  const tar = gunzipSync(Buffer.from(await res.arrayBuffer()));

  for (const dir of ["fonts", "sprites"]) rmSync(join(outDir, dir), { recursive: true, force: true });
  let written = 0;
  untar(tar, (path, bytes) => {
    // Drop the archive's top-level `<repo>-<sha>/` directory.
    const rel = path.slice(path.indexOf("/") + 1);
    if (!wanted(rel)) return;
    const dest = join(outDir, ...rel.split("/"));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    written++;
  });
  if (written === 0) throw new Error("archive contained none of the expected fonts or sprites");
  writeFileSync(stampFile, `${ASSETS_SHA}\n`);
  return written;
}

async function main() {
  copyWorker();
  const stamp = existsSync(stampFile) ? readFileSync(stampFile, "utf8").trim() : "";
  if (stamp === ASSETS_SHA) return;
  try {
    const written = await fetchAssets();
    console.log(`[basemap-assets] ${written} files from ${ASSETS_REPO}@${ASSETS_SHA.slice(0, 7)}`);
  } catch (err) {
    const message = `[basemap-assets] could not fetch label fonts and sprites: ${err instanceof Error ? err.message : err}`;
    if (strict) {
      console.error(message);
      process.exit(1);
    }
    console.warn(`${message}. Vector basemaps will draw without labels and icons until this succeeds.`);
  }
}

await main();
