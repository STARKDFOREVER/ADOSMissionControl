/**
 * Archive registration claims are compared with the manifest and signature the
 * archive carries; the first disagreeing field is named.
 *
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";

import {
  MANIFEST_MISMATCH,
  findClaimMismatch,
  parseManifestFacts,
} from "../../convex/lib/pluginManifestClaims";

const MANIFEST = `
id: com.example.camera
version: 1.2.0
agent:
  permissions:
    - id: camera.read
    - id: network.outbound
      required: false
gcs:
  permissions:
    - ui.panel
`;

const CLAIMS = {
  pluginId: "com.example.camera",
  version: "1.2.0",
  declaredPermissions: [
    { id: "ui.panel", required: true },
    { id: "camera.read", required: true },
    { id: "network.outbound", required: false },
  ],
};

describe("findClaimMismatch", () => {
  it("accepts claims that match the manifest in any permission order", () => {
    expect(findClaimMismatch(parseManifestFacts(MANIFEST), null, CLAIMS)).toBeNull();
  });

  it("claimed_permissions_mismatch_rejected", () => {
    const facts = parseManifestFacts(MANIFEST);
    expect(
      findClaimMismatch(facts, null, {
        ...CLAIMS,
        declaredPermissions: CLAIMS.declaredPermissions.filter((p) => p.id !== "camera.read"),
      }),
    ).toBe("declaredPermissions");
    expect(
      findClaimMismatch(facts, null, {
        ...CLAIMS,
        declaredPermissions: CLAIMS.declaredPermissions.map((p) =>
          p.id === "network.outbound" ? { ...p, required: true } : p,
        ),
      }),
    ).toBe("declaredPermissions");
  });

  it("names a plugin id or version the manifest does not declare", () => {
    const facts = parseManifestFacts(MANIFEST);
    expect(findClaimMismatch(facts, null, { ...CLAIMS, pluginId: "com.example.other" })).toBe(
      "pluginId",
    );
    expect(findClaimMismatch(facts, null, { ...CLAIMS, version: "1.2.1" })).toBe("version");
  });

  it("checks a claimed signer against the SIGNATURE entry only when one is claimed", () => {
    const facts = parseManifestFacts(MANIFEST);
    const signature = "example-signer-1\nQUJD\n";
    expect(findClaimMismatch(facts, signature, { ...CLAIMS, signerId: "example-signer-1" })).toBeNull();
    expect(findClaimMismatch(facts, signature, { ...CLAIMS, signerId: "example-signer-2" })).toBe(
      "signerId",
    );
    expect(findClaimMismatch(facts, null, { ...CLAIMS, signerId: "example-signer-1" })).toBe(
      "signerId",
    );
    expect(findClaimMismatch(facts, signature, CLAIMS)).toBeNull();
  });

  it("refuses a manifest that is not a YAML mapping", () => {
    expect(() => parseManifestFacts("- just\n- a list\n")).toThrow(MANIFEST_MISMATCH);
  });
});
