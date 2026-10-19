/**
 * @module ground-station/lora/lora-format
 * @description Pure helpers for the LoRa governor views: the transmit
 * countdown, the module-band parse and the meter tone.
 * @license GPL-3.0-only
 */

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
