/**
 * The WHEP pairing key travels only to the node's own origin.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { whepAuthHeaders, whepKeyFor } from "@/lib/video/webrtc/whep-auth";

describe("whepKeyFor", () => {
  it("returns the key for a WHEP URL on the node's own origin", () => {
    expect(whepKeyFor("http://192.168.1.50:8080/whep", "http://192.168.1.50:8080", "k")).toBe("k");
    expect(
      whepKeyFor("http://192.168.1.50:8080/whep?camera=ir", "http://192.168.1.50:8080/", "k"),
    ).toBe("k");
  });

  it("withholds the key from any other origin", () => {
    expect(whepKeyFor("http://localhost:8889/sitl/whep", "http://192.168.1.50:8080", "k")).toBeNull();
    expect(whepKeyFor("http://192.168.1.50:8889/main/whep", "http://192.168.1.50:8080", "k")).toBeNull();
  });

  it("is null when any input is missing or unparseable", () => {
    expect(whepKeyFor(null, "http://192.168.1.50:8080", "k")).toBeNull();
    expect(whepKeyFor("http://192.168.1.50:8080/whep", null, "k")).toBeNull();
    expect(whepKeyFor("http://192.168.1.50:8080/whep", "http://192.168.1.50:8080", null)).toBeNull();
    expect(whepKeyFor("/whep", "http://192.168.1.50:8080", "k")).toBeNull();
  });
});

describe("whepAuthHeaders", () => {
  it("carries X-ADOS-Key only when there is a key", () => {
    expect(whepAuthHeaders("k")).toEqual({ "X-ADOS-Key": "k" });
    expect(whepAuthHeaders(null)).toEqual({});
  });
});
