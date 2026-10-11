#!/usr/bin/env node
/**
 * Report, per locale, the keys whose value is still the English string.
 *
 * `i18n-merge-missing.mjs` backfills missing keys with the English value so
 * the parity test passes; this report shows translators what is left. It is
 * report-only and always exits 0. Values that are legitimately identical in
 * every language (brand names, units, numbers) show up too.
 *
 * Usage: node scripts/i18n-report-untranslated.mjs [--keys] [locale...]
 *   --keys   list every untranslated key, not just the per-locale count
 *   locale   limit the report to these locale codes (e.g. `de fr`)
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(resolve(here, ".."), "locales");

const args = process.argv.slice(2);
const listKeys = args.includes("--keys");
const only = new Set(args.filter((a) => !a.startsWith("--")));

function readLocale(file) {
  return JSON.parse(readFileSync(join(localesDir, file), "utf8"));
}

/** Collect dotted paths of string leaves where `target` equals `source`. */
function sameAsEnglish(source, target, prefix, out) {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const other = target?.[key];
    if (typeof value === "string") {
      if (other === value && /\p{L}/u.test(value)) out.push(path);
    } else if (value && typeof value === "object" && other && typeof other === "object") {
      sameAsEnglish(value, other, path, out);
    }
  }
  return out;
}

function countStrings(node) {
  let n = 0;
  for (const value of Object.values(node)) {
    if (typeof value === "string") n += 1;
    else if (value && typeof value === "object") n += countStrings(value);
  }
  return n;
}

const en = readLocale("en.json");
const total = countStrings(en);
const files = readdirSync(localesDir)
  .filter((f) => f.endsWith(".json") && f !== "en.json")
  .filter((f) => only.size === 0 || only.has(f.replace(/\.json$/, "")))
  .sort();

console.log(`English strings: ${total}`);
for (const file of files) {
  const keys = sameAsEnglish(en, readLocale(file), "", []);
  const pct = total ? ((keys.length / total) * 100).toFixed(1) : "0.0";
  console.log(`${file.replace(/\.json$/, "")}: ${keys.length} untranslated (${pct}%)`);
  if (listKeys) for (const key of keys) console.log(`  ${key}`);
}
