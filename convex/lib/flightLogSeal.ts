/**
 * @module convex/lib/flightLogSeal
 * @description Server-side seal checks for flight-log upserts: a sealed record
 * may change only its volatile fields until it is unsealed.
 *
 * @license GPL-3.0-only
 */

import { RECORD_VALIDATOR } from "./flightLogValidator";

/**
 * Fields that may change on a sealed record without unsealing first.
 * Mirrors `compliance/sign.ts:VOLATILE_KEYS` on the client side.
 */
const VOLATILE_KEYS = new Set([
  "updatedAt",
  "events",
  "flags",
  "health",
  "notes",
  "tags",
  "favorite",
  "customName",
  // The signature fields: `sealTransition` governs how they may change.
  "pilotSignedAt",
  "pilotSignatureHash",
  // Soft-delete is a metadata operation that should not break the seal.
  "deleted",
  "deletedAt",
  // Linked media is evidence attached after the flight, not flight data.
  "media",
]);

/** Rebuild a value with every object's keys in sorted order, at any depth. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== "object") return value;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) out[key] = sortKeysDeep(src[key]);
  return out;
}

/** SHA-256 over a record's sealed (non-volatile) record fields, server side. */
async function sealedContentDigest(row: Record<string, unknown>): Promise<string> {
  const sealed: Record<string, unknown> = {};
  for (const key of Object.keys(RECORD_VALIDATOR)) {
    if (VOLATILE_KEYS.has(key) || key === "clientId") continue;
    sealed[key] = row[key];
  }
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(sortKeysDeep(sealed))),
  );
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Seal transitions for an upsert over an existing row. Returns the server-side
 * bookkeeping to write alongside the record, or throws.
 *
 *  - A sealed row accepts only volatile-field changes, and its signature can
 *    only be cleared (unsealed), never swapped for another.
 *  - Unsealing records the released signature and a server digest of the
 *    content it covered.
 *  - Re-applying that released signature is refused unless the content is
 *    still the content it covered, so unseal -> edit -> restore-old-hash
 *    cannot produce a record that reads sealed over altered data.
 */
export async function sealTransition(
  existing: Record<string, unknown>,
  record: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const wasSealed = typeof existing.pilotSignatureHash === "string" && existing.pilotSignatureHash !== "";
  const nextHash = typeof record.pilotSignatureHash === "string" ? record.pilotSignatureHash : "";

  if (wasSealed) {
    for (const key of Object.keys(record)) {
      if (VOLATILE_KEYS.has(key) || key === "clientId") continue;
      // Compare via JSON to handle nested objects deterministically.
      if (JSON.stringify(record[key]) !== JSON.stringify(existing[key])) {
        throw new Error(`Cannot mutate '${key}' on a sealed record. Unseal first.`);
      }
    }
    if (nextHash === "") {
      console.log(`flight log ${String(existing.clientId)} unsealed`);
      // A patch leaves absent fields alone, so the unseal must clear the
      // signature explicitly.
      return {
        pilotSignatureHash: undefined,
        pilotSignedAt: undefined,
        unsealedHash: existing.pilotSignatureHash,
        unsealedContentDigest: await sealedContentDigest(existing),
        unsealedAt: Date.now(),
      };
    }
    if (nextHash !== existing.pilotSignatureHash) {
      throw new Error("A sealed record's signature cannot be replaced. Unseal first.");
    }
    return {};
  }

  if (nextHash !== "" && nextHash === existing.unsealedHash) {
    if ((await sealedContentDigest(record)) !== existing.unsealedContentDigest) {
      throw new Error("A released signature cannot seal content that changed since it was released.");
    }
  }
  return {};
}
