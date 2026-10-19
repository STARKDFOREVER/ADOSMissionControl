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

/** Reasons that clear on their own once the rule's window moves on. */
export const WAITING_REASONS: Record<string, true> = { duty_exhausted: true, dwell_time: true, lbt_busy: true };

export type LoraTxState = "allowed" | "paused" | "blocked";

/** Transmit verdict per the lane contract: allowed only when `tx_allowed`
 * and no `blocked_reason`; a transient reason is a pause, any other a block. */
export function loraTxState(status: Pick<LoraStatus, "tx_allowed" | "blocked_reason">): LoraTxState {
  if (status.tx_allowed && status.blocked_reason == null) return "allowed";
  const reason = status.blocked_reason ?? "region_unset";
  return Object.hasOwn(WAITING_REASONS, reason) ? "paused" : "blocked";
}

/** ELRS domains that live in the 2.4 GHz band; every other domain is a
 * sub-GHz (`900` key) domain. */
const ELRS_2G4_DOMAINS: Record<string, true> = { ISM2G4: true, CE_LBT: true };

/** EU member states plus the EEA (IS, LI, NO), whose country setting resolves
 * to the shared `EU` plan. */
const EU_EEA: Record<string, true> = Object.fromEntries(
  ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV",
    "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO"].map((c) => [c, true]),
);

/**
 * The LoRa plan code a country setting resolves to in the region table: the
 * row named by the country itself, else `EU` for an EU/EEA member when the
 * table has an `EU` row. Null when the table does not resolve it (or is not
 * loaded), in which case no comparison is made.
 */
export function countryPlanCode(
  country: string,
  regions: readonly LoraRegionPlan[] | null,
): string | null {
  if (!regions) return null;
  const c = country.toUpperCase();
  if (regions.some((r) => r.code.toUpperCase() === c)) return c;
  if (Object.hasOwn(EU_EEA, c) && regions.some((r) => r.code.toUpperCase() === "EU")) return "EU";
  return null;
}

/** An amber advisory under the region line. Never blocks; the agent's own
 * `blocked_reason` is the blocking form. */
export type LoraMismatch =
  | { kind: "meshtastic"; preset: string; expected: string }
  | { kind: "country"; country: string; code: string }
  | { kind: "elrs"; module: string; domain: string; expected: string; code: string };

/**
 * Advisories for the active region:
 * - the Meshtastic bridge preset is not the preset the region maps to (an
 *   enabled bridge, both presets known, compared exactly);
 * - the region was set explicitly (`lora.region`) and is not the plan the
 *   node's country setting resolves to (an unresolvable country: no chip);
 * - an ELRS module reports a domain other than the one the region row expects
 *   for that module's band. A null module domain or a null expectation means
 *   no claim, so no chip.
 */
export function loraMismatches(
  status: LoraStatus,
  plan: LoraRegionPlan | null,
  countryRegion: string | null,
  regions: readonly LoraRegionPlan[] | null,
  modules: readonly ElrsModule[],
): LoraMismatch[] {
  const region = status.region;
  if (!region) return [];
  const code = region.code.toUpperCase();
  const out: LoraMismatch[] = [];
  const preset = status.meshtastic?.enabled ? status.meshtastic.region_preset : null;
  const expectedPreset = region.meshtastic_preset ?? null;
  if (preset && expectedPreset && preset !== expectedPreset) {
    out.push({ kind: "meshtastic", preset, expected: expectedPreset });
  }
  const countryPlan = countryRegion ? countryPlanCode(countryRegion, regions) : null;
  if (region.source === "lora.region" && countryRegion && countryPlan && countryPlan !== code) {
    out.push({ kind: "country", country: countryRegion.toUpperCase(), code });
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
