/**
 * @module convex/lib/pluginManifestClaims
 * @description Compare an archive registration's client claims with the
 * manifest and signature the archive actually carries.
 *
 * The registration action already extracts `manifest.yaml` to hash it. The
 * plugin id, version, declared permission set and signer id were still stored
 * as the client sent them, so the archive row (and any consent surface that
 * reads `declaredPermissions`) could disagree with the manifest that ships.
 * This module reads those fields from the extracted bytes with the same rules
 * the install dialog uses to build its claims, and names the first field that
 * differs.
 *
 * Pure functions with no Convex runtime dependency, so they are unit-testable.
 *
 * @license GPL-3.0-only
 */

import YAML from "yaml";

/** Error code thrown when a claim disagrees with the archive. */
export const MANIFEST_MISMATCH = "E_MANIFEST_MISMATCH";

export interface DeclaredPermissionClaim {
  id: string;
  required: boolean;
}

export interface ArchiveClaims {
  pluginId: string;
  version: string;
  declaredPermissions: ReadonlyArray<DeclaredPermissionClaim>;
  signerId?: string;
}

export interface ManifestFacts {
  pluginId: string;
  version: string;
  declaredPermissions: DeclaredPermissionClaim[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function collectPermissions(source: unknown, into: DeclaredPermissionClaim[]): void {
  if (!Array.isArray(source)) return;
  for (const entry of source) {
    if (typeof entry === "string") {
      const id = entry.trim();
      if (id !== "") into.push({ id, required: true });
      continue;
    }
    if (isObject(entry)) {
      const id = str(entry.id);
      if (!id) continue;
      into.push({ id, required: entry.required !== false });
    }
  }
}

/**
 * Read the claim-bearing fields out of a manifest. Throws when the text is not
 * a YAML mapping, since an archive whose manifest cannot be read has no claims
 * that can be checked.
 */
export function parseManifestFacts(text: string): ManifestFacts {
  let doc: unknown;
  try {
    doc = YAML.parse(text, { strict: false });
  } catch {
    throw new Error(`${MANIFEST_MISMATCH}: manifest is not valid YAML`);
  }
  if (!isObject(doc)) {
    throw new Error(`${MANIFEST_MISMATCH}: manifest is not a mapping`);
  }
  const declaredPermissions: DeclaredPermissionClaim[] = [];
  // Same order and sources as the install dialog: agent half, GCS half, then
  // the legacy top-level list.
  collectPermissions(isObject(doc.agent) ? doc.agent.permissions : undefined, declaredPermissions);
  collectPermissions(isObject(doc.gcs) ? doc.gcs.permissions : undefined, declaredPermissions);
  collectPermissions(doc.permissions, declaredPermissions);
  return {
    pluginId: str(doc.id) ?? str(doc.plugin_id) ?? "",
    version: str(doc.version) ?? "",
    declaredPermissions,
  };
}

/** The signer id line of a `SIGNATURE` entry, or null when it is malformed. */
export function signatureSignerId(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length === 2 ? lines[0] : null;
}

function permissionKeys(list: ReadonlyArray<DeclaredPermissionClaim>): string[] {
  return list.map((p) => `${p.id}\u0000${p.required ? 1 : 0}`).sort();
}

/**
 * The first claimed field that disagrees with the archive, or null when every
 * claim matches. Permission order is not significant; the id and required flag
 * of every entry are. A signer id is only claimed when the client verified the
 * archive's signature, so an absent claim is not checked; a present one must
 * equal the signer line of the archive's `SIGNATURE` entry.
 */
export function findClaimMismatch(
  facts: ManifestFacts,
  signatureText: string | null,
  claims: ArchiveClaims,
): "pluginId" | "version" | "declaredPermissions" | "signerId" | null {
  if (facts.pluginId !== claims.pluginId) return "pluginId";
  if (facts.version !== claims.version) return "version";
  const actual = permissionKeys(facts.declaredPermissions);
  const claimed = permissionKeys(claims.declaredPermissions);
  if (actual.length !== claimed.length || actual.some((key, i) => key !== claimed[i])) {
    return "declaredPermissions";
  }
  if (claims.signerId !== undefined) {
    const signer = signatureText === null ? null : signatureSignerId(signatureText);
    if (signer !== claims.signerId) return "signerId";
  }
  return null;
}
