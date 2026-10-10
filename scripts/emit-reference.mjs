#!/usr/bin/env node
/**
 * Emit docs/reference/gcs-routes.json: every Next.js app-router page in
 * src/app, as the URL path an operator types.
 *
 *   node scripts/emit-reference.mjs           write the file
 *   node scripts/emit-reference.mjs --check   exit 1 when the committed file differs
 *
 * Route groups `(name)` and parallel-route slots `@name` are not URL segments
 * and are stripped. `[x]` becomes `:x` and marks the route dynamic; catch-all
 * `[...x]` becomes `:x*` and optional catch-all `[[...x]]` becomes `:x*?`.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(ROOT, "src", "app");
const OUT = join(ROOT, "docs", "reference", "gcs-routes.json");

function findPages(dir) {
  const pages = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) pages.push(...findPages(full));
    else if (entry.name === "page.tsx") pages.push(full);
  }
  return pages;
}

function toRoute(pageFile) {
  const rel = relative(APP_DIR, dirname(pageFile));
  const segments = rel === "" ? [] : rel.split(sep);
  let dynamic = false;
  const parts = [];
  for (const seg of segments) {
    if (/^\(.*\)$/.test(seg) || seg.startsWith("@")) continue;
    let m;
    if ((m = /^\[\[\.\.\.(.+)\]\]$/.exec(seg))) {
      parts.push(`:${m[1]}*?`);
      dynamic = true;
    } else if ((m = /^\[\.\.\.(.+)\]$/.exec(seg))) {
      parts.push(`:${m[1]}*`);
      dynamic = true;
    } else if ((m = /^\[(.+)\]$/.exec(seg))) {
      parts.push(`:${m[1]}`);
      dynamic = true;
    } else {
      parts.push(seg);
    }
  }
  return { path: `/${parts.join("/")}`, dynamic };
}

export function buildReference() {
  const seen = new Map();
  for (const page of findPages(APP_DIR)) {
    const route = toRoute(page);
    seen.set(route.path, route);
  }
  const routes = [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return `${JSON.stringify({ schema: 1, routes }, null, 2)}\n`;
}

const text = buildReference();
if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
  if (current !== text) {
    console.error(`docs/reference/gcs-routes.json is out of date; run node scripts/emit-reference.mjs`);
    process.exit(1);
  }
  console.log("docs/reference/gcs-routes.json is current");
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  console.log(`wrote ${relative(ROOT, OUT)}`);
}
