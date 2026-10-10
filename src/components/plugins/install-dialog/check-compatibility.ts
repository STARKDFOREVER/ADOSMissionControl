/**
 * @module checkCompatibility
 * @description Pure helper that compares a parsed plugin manifest's
 * hardware requirements against the connected drone's reported board
 * id + RAM. Returns granular fields so the review modal can render
 * a per-row breakdown and disable the install button when the board
 * is hard-incompatible.
 *
 * The helper stays optimistic when data is missing — an older agent
 * heartbeat that omits RAM should not block an install, since the
 * agent revalidates every constraint server-side at archive time.
 *
 * @license GPL-3.0-only
 */

import type { InstallManifestSummary } from "./types";

export interface CompatibilityHost {
  /** HAL profile stem from the agent (`rock-5c-lite`, `rpi5`). The id a
   * plugin's board list names. Undefined when the agent has not reported
   * one. */
  boardProfile?: string;
  /** Marketing board name (`Radxa ROCK 5C Lite`). */
  boardName?: string;
  /** SoC identifier (`rk3582`, `bcm2710a1`). */
  boardSoc?: string;
  /** Total host RAM in MB. Undefined when the agent has not reported
   * it. */
  ramTotalMb?: number;
}

export interface CompatibilityResult {
  boardCompatible: boolean;
  boardReason?: string;
  ramOk: boolean;
  ramReason?: string;
  cpuOk: boolean;
  cpuReason?: string;
}

/**
 * The one board gate. A plugin board list matches when it is empty, holds
 * `"*"`, or names the host's profile stem, board name or SoC
 * (case-insensitive). Optimistic when the host reported no identity: the
 * agent revalidates server-side.
 */
export function boardListMatches(
  boards: readonly string[],
  host: Pick<CompatibilityHost, "boardProfile" | "boardName" | "boardSoc">,
): boolean {
  if (boards.length === 0 || boards.includes("*")) return true;
  const candidates = [host.boardProfile, host.boardName, host.boardSoc]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());
  if (candidates.length === 0) return true;
  const supported = new Set(boards.map((b) => b.toLowerCase()));
  return candidates.some((c) => supported.has(c));
}

export function checkCompatibility(
  manifest: InstallManifestSummary,
  host: CompatibilityHost,
): CompatibilityResult {
  const boardCompatible = boardListMatches(
    manifest.hardwareRequirements?.boards ?? [],
    host,
  );

  const boardReason = boardCompatible
    ? undefined
    : host.boardProfile ??
      host.boardName ??
      host.boardSoc ??
      "unknown board";

  const ramRequired = manifest.resourceImpact?.ramMb;
  let ramOk = true;
  let ramReason: string | undefined;
  if (
    typeof ramRequired === "number" &&
    typeof host.ramTotalMb === "number" &&
    host.ramTotalMb > 0
  ) {
    if (host.ramTotalMb < ramRequired) {
      ramOk = false;
      ramReason = `${ramRequired} MB needed, host has ${host.ramTotalMb} MB`;
    }
  }

  // CPU peak is a forecast; the supervisor enforces hard limits at
  // runtime. We always render this row green unless the manifest
  // explicitly flags >90% peak, at which point we surface a warning
  // line but do not block install.
  const cpuPeak = manifest.resourceImpact?.cpuPercentPeak;
  let cpuOk = true;
  let cpuReason: string | undefined;
  if (typeof cpuPeak === "number" && cpuPeak >= 90) {
    cpuOk = false;
    cpuReason = `peak ${cpuPeak}% may sustain high host load`;
  }

  return {
    boardCompatible,
    boardReason,
    ramOk,
    ramReason,
    cpuOk,
    cpuReason,
  };
}
