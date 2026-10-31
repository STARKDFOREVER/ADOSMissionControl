/**
 * @module convex/lib/pairingCodes
 * @description Pairing-code format, limits and input bounds shared by the
 * pairing functions.
 *
 * @license GPL-3.0-only
 */

export const SAFE_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const PAIRING_CODE_RE = new RegExp(
  `^[${SAFE_CHARSET}]{${CODE_LENGTH}}$`,
);
export const MAX_DEVICE_ID_LENGTH = 96;
export const MAX_LABEL_LENGTH = 128;
export const MAX_API_KEY_LENGTH = 256;
export const MAX_SECRET_LENGTH = 128;
/** Shared bucket every failed anonymous code claim charges. */
export const CLAIM_GLOBAL_BUCKET = "claim:global";
/** A browser session is a long-lived local identity; 180 days of idle is dead. */
export const BROWSER_SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** Cap on the rows `getMyPendingCodes` returns; a UI list, not a bulk export. */
export const MAX_PENDING_CODES = 50;
/** Cap on the broker sync payload. Bounds an unbounded double `.collect()`. */
export const MAX_MQTT_AUTH_ENTRIES = 2000;

export function normalizePairingCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!PAIRING_CODE_RE.test(normalized)) {
    throw new Error("Pairing code must be six safe uppercase characters");
  }
  return normalized;
}

export function generatePairingCode(): string {
  // The pairing code is a bearer credential — presenting it claims the agent —
  // so it must be unpredictable. Draw from a CSPRNG and rejection-sample to
  // avoid modulo bias across the 31-character charset.
  const limit = Math.floor(256 / SAFE_CHARSET.length) * SAFE_CHARSET.length;
  let pairingCode = "";
  while (pairingCode.length < CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    for (let i = 0; i < bytes.length && pairingCode.length < CODE_LENGTH; i++) {
      if (bytes[i] < limit) {
        pairingCode += SAFE_CHARSET[bytes[i] % SAFE_CHARSET.length];
      }
    }
  }
  return pairingCode;
}

export function requireBoundedString(value: string, name: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} required`);
  if (trimmed.length > max) throw new Error(`${name} too long`);
  return trimmed;
}

export function optionalBoundedString(
  value: string | undefined,
  name: string,
  max: number,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new Error(`${name} too long`);
  return trimmed;
}
