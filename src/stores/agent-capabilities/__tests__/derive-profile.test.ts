/**
 * @license GPL-3.0-only
 */

import { describe, expect, it, vi } from "vitest";
import { deriveProfile } from "../derivers";

describe("deriveProfile", () => {
  it("reads every profile an agent can run, in either ground-station spelling", () => {
    expect(deriveProfile({ profile: "drone" })).toBe("drone");
    expect(deriveProfile({ profile: "ground-station" })).toBe("ground-station");
    expect(deriveProfile({ profile: "ground_station" })).toBe("ground-station");
    expect(deriveProfile({ profile: "workstation" })).toBe("workstation");
    expect(deriveProfile({ profile: "compute" })).toBe("compute");
    expect(deriveProfile({ profile: "visor" })).toBe("visor");
    expect(deriveProfile({ node_profile: "visor" })).toBe("visor");
  });

  it("reads a legacy heartbeat with no profile as a drone", () => {
    expect(deriveProfile({})).toBe("drone");
  });

  it("keeps a profile it does not know as unknown instead of clamping it to drone", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(deriveProfile({ profile: "satellite" })).toBe("unknown");
    expect(deriveProfile({ profile: "satellite" })).toBe("unknown");
    // Warned once per unknown value, not at heartbeat rate.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
