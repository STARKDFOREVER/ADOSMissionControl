/**
 * @module PluginManifestCorpusTest
 * @description The GCS consumer of the shared plugin manifest conformance
 * corpus at `ADOSDroneAgent/schemas/fixtures/plugin-manifest/`. The agent's
 * Python model and the Rust plugin host read the same files; this test pins
 * the client-side install preview (`parseManifestYaml`) to them.
 *
 * - every `valid/*.yaml` parses, and the preview keeps its id, version and
 *   every declared permission (with the half it was declared under);
 * - every `invalid/*.yaml` has a `[<stem>]` table with a `rule` in
 *   `invalid/expected.toml`, and the
 *   preview either parses it or fails with a plain `Error`, never a crash.
 *   The preview is not the install authority (the agent rejects these), so
 *   rejection itself is asserted by the agent-side consumers.
 *
 * The corpus lives in a sibling checkout. A standalone GCS clone has no
 * sibling, so the suite is skipped explicitly rather than passing vacuously.
 *
 * @license GPL-3.0-only
 */

import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { parseManifestYaml } from "@/components/plugins/transports/manifest-parse";

const CORPUS = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "ADOSDroneAgent",
  "schemas",
  "fixtures",
  "plugin-manifest",
);

const hasCorpus = fs.existsSync(path.join(CORPUS, "valid"));

function yamlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
}

/** `[<fixture stem>]` tables of `invalid/expected.toml`, each with its `rule`. */
function readExpected(file: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(file)) return out;
  let table: string | null = null;
  for (const line of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
    const header = line.match(/^\s*\[\s*"?([^"\]]+)"?\s*\]\s*$/);
    if (header) {
      table = header[1];
      out.set(table, "");
      continue;
    }
    const rule = line.match(/^\s*rule\s*=\s*"(.*)"\s*$/);
    if (rule && table !== null) out.set(table, rule[1]);
  }
  return out;
}

/** Permission ids declared under one half's `permissions:` list. */
function declaredPermissions(raw: unknown, half: "agent" | "gcs"): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  const block = (raw as Record<string, unknown>)[half];
  if (typeof block !== "object" || block === null) return [];
  const perms = (block as Record<string, unknown>).permissions;
  if (!Array.isArray(perms)) return [];
  return perms
    .map((p) => (typeof p === "string" ? p : (p as { id?: unknown } | null)?.id))
    .filter((id): id is string => typeof id === "string");
}

describe.skipIf(!hasCorpus)("plugin manifest conformance corpus", () => {
  const valid = yamlFiles(path.join(CORPUS, "valid"));
  const invalid = yamlFiles(path.join(CORPUS, "invalid"));

  it("has fixtures on both sides", () => {
    expect(valid.length).toBeGreaterThan(0);
    expect(invalid.length).toBeGreaterThan(0);
  });

  it.each(valid)("valid/%s parses with id, version and permissions intact", (file) => {
    const text = fs.readFileSync(path.join(CORPUS, "valid", file), "utf-8");
    const raw = YAML.parse(text) as Record<string, unknown>;
    const parsed = parseManifestYaml(text);

    expect(parsed.pluginId).toBe(String(raw.id));
    expect(parsed.version).toBe(String(raw.version));
    for (const half of ["agent", "gcs"] as const) {
      const got = parsed.permissions.filter((p) => p.half === half).map((p) => p.id);
      expect(got).toEqual(declaredPermissions(raw, half));
    }
  });

  it("lists every invalid fixture in invalid/expected.toml", () => {
    const expected = readExpected(path.join(CORPUS, "invalid", "expected.toml"));
    const missing = invalid.filter((f) => !expected.get(f.replace(/\.ya?ml$/, "")));
    expect(missing).toEqual([]);
  });

  it.each(invalid)("invalid/%s never crashes the install preview", (file) => {
    const text = fs.readFileSync(path.join(CORPUS, "invalid", file), "utf-8");
    try {
      parseManifestYaml(text);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});

describe.runIf(!hasCorpus)("plugin manifest conformance corpus (absent)", () => {
  it.skip(`skipped: no corpus checkout at ${CORPUS}`, () => {});
});
