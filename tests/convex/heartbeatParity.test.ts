/**
 * Key parity between the agent's cloud heartbeat and the `pushStatus`
 * validator. `HeartbeatPayload` is generated from the agent's heartbeat
 * schema; every key it may send must be declared by `pushStatusArgs` or be
 * one of the keys the `/agent/status` filter strips on purpose. An undeclared
 * key is dropped and reported as unknown, so a column the agent fills would
 * never reach this deployment.
 *
 * @license GPL-3.0-only
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { HeartbeatPayload } from "../../convex/lib/agentHeartbeat.generated";
import { STRIPPED_KEYS } from "../../convex/lib/agentStatusPayload";
import { pushStatusArgs } from "../../convex/lib/pushStatusArgs";

/** Heartbeat keys the filter strips rather than forwarding as status. */
type StrippedHeartbeatKey = "agentVersion";

/** Compile-time half: fails to type-check when the agent adds a heartbeat key
 * that `pushStatusArgs` does not declare. */
type UndeclaredHeartbeatKeys = Exclude<
  keyof HeartbeatPayload,
  keyof typeof pushStatusArgs | StrippedHeartbeatKey
>;
const allHeartbeatKeysDeclared: [UndeclaredHeartbeatKeys] extends [never] ? true : never = true;

const GENERATED = path.join(process.cwd(), "convex", "lib", "agentHeartbeat.generated.ts");

/** The top-level keys of `HeartbeatPayload`, read from the generated source. */
function generatedHeartbeatKeys(): string[] {
  const source = readFileSync(GENERATED, "utf8");
  const match = /export interface HeartbeatPayload \{\r?\n([\s\S]*?)\r?\n\}/.exec(source);
  if (!match) throw new Error("HeartbeatPayload not found in the generated file");
  return [...match[1].matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
}

describe("heartbeat key parity", () => {
  it("declares every generated heartbeat key in pushStatusArgs", () => {
    expect(allHeartbeatKeysDeclared).toBe(true);
    const keys = generatedHeartbeatKeys();
    expect(keys.length).toBeGreaterThan(0);
    const declared = new Set(Object.keys(pushStatusArgs));
    const undeclared = keys.filter((key) => !declared.has(key) && !STRIPPED_KEYS.has(key));
    expect(undeclared).toEqual([]);
  });

  it("strips exactly the keys the type-level check exempts", () => {
    const stripped: StrippedHeartbeatKey[] = ["agentVersion"];
    const keys = new Set(generatedHeartbeatKeys());
    for (const key of stripped) {
      expect(keys.has(key)).toBe(true);
      expect(STRIPPED_KEYS.has(key)).toBe(true);
    }
    const exempt = [...STRIPPED_KEYS].filter((key) => keys.has(key)).sort();
    expect(exempt).toEqual([...stripped].sort());
  });
});
