/**
 * @module ground-station/lora/lora-format
 * @description Pure helpers for the LoRa governor views: the transmit
 * countdown, the module-band parse and the meter tone.
 * @license GPL-3.0-only
 */

import type { ElrsModule, LoraRegionPlan, LoraStatus } from "@/lib/api/ground-station/types";

/** `mm:ss` for a non-negative millisecond span (rounded up to whole seconds,
 * so a pending block never reads 00:00). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Milliseconds until the governor admits the next frame, counted down
 * locally from the value read at `fetchedAt`. */
export function remainingMs(nextTxAllowedMs: number, fetchedAt: number | null, now: number): number {
  if (!Number.isFinite(nextTxAllowedMs) || nextTxAllowedMs <= 0) return 0;
  const elapsed = fetchedAt === null ? 0 : Math.max(0, now - fetchedAt);
  return Math.max(0, nextTxAllowedMs - elapsed);
}

/** `"850-930"` → `[850, 930]`; null for `any` or an unparsable band. */
export function parseBand(band: string | null): [number, number] | null {
  if (!band) return null;
  const m = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(band.trim());
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  return lo < hi ? [lo, hi] : null;
}

export type MeterTone = "neutral" | "warning" | "error";

/** Below 70 % of the limit neutral, 70–99 % amber, at the limit red. */
export function meterTone(fraction: number): MeterTone {
  if (fraction >= 1) return "error";
  if (fraction >= 0.7) return "warning";
  return "neutral";
}

/** Country codes whose plan carries rows not cleared for airborne use. */
export const AIRBORNE_RESTRICTED: Record<string, true> = { RU: true, GB: true, NO: true };

/** ELRS domains that live in the 2.4 GHz band; every other domain is a
 * sub-GHz (`900` key) domain. */
const ELRS_2G4_DOMAINS: Record<string, true> = { ISM2G4: true, CE_LBT: true };

/** An amber advisory under the region line. Never blocks; the agent's own
 * `blocked_reason` is the blocking form. */
export type LoraMismatch =
  | { kind: "meshtastic"; preset: string; code: string }
  | { kind: "country"; country: string; code: string }
  | { kind: "elrs"; module: string; domain: string; expected: string; code: string };

/**
 * Advisories for the active region:
 * - the Meshtastic bridge preset is not the region (an enabled bridge whose
 *   preset is neither the code nor a `<code>_<band>` preset);
 * - the region was set explicitly (`lora.region`) and differs from the node's
 *   country setting;
 * - an ELRS module reports a domain other than the one the region row expects
 *   for that module's band. A null module domain or a null expectation means
 *   no claim, so no chip.
 */
export function loraMismatches(
  status: LoraStatus,
  plan: LoraRegionPlan | null,
  countryRegion: string | null,
  modules: readonly ElrsModule[],
): LoraMismatch[] {
  const region = status.region;
  if (!region) return [];
  const code = region.code.toUpperCase();
  const out: LoraMismatch[] = [];
  const preset = status.meshtastic?.enabled ? status.meshtastic.region_preset : null;
  if (preset) {
    const p = preset.toUpperCase();
    if (p !== code && !p.startsWith(`${code}_`)) out.push({ kind: "meshtastic", preset, code });
  }
  const country = countryRegion?.toUpperCase() ?? null;
  if (region.source === "lora.region" && country && country !== code) {
    out.push({ kind: "country", country, code });
  }
  const expected = plan?.elrs_domains ?? null;
  if (expected) {
    for (const m of modules) {
      if (!m.domain) continue;
      const want = Object.hasOwn(ELRS_2G4_DOMAINS, m.domain) ? expected["2g4"] : expected["900"];
      if (want && want !== m.domain) {
        out.push({ kind: "elrs", module: m.id, domain: m.domain, expected: want, code });
      }
    }
  }
  return out;
}
