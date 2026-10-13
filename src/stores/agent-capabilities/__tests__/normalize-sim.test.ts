import { describe, it, expect, beforeEach } from "vitest";
import { normalizeCapabilities } from "../normalizer";
import { useAgentCapabilitiesStore, selectDeviceCapabilities } from "../state";

describe("normalizeCapabilities sim flag", () => {
  it("passes a boolean through", () => {
    expect(normalizeCapabilities({ tier: 4, sim: true }).sim).toBe(true);
    expect(normalizeCapabilities({ tier: 4, sim: false }).sim).toBe(false);
  });

  it("reads an absent or non-boolean value as undefined", () => {
    expect(normalizeCapabilities({ tier: 4 }).sim).toBeUndefined();
    expect(normalizeCapabilities({ tier: 4, sim: "yes" }).sim).toBeUndefined();
  });
});

describe("agent capabilities store sim flag", () => {
  beforeEach(() => {
    useAgentCapabilitiesStore.getState().clear();
  });

  it("files the flag under the node and keeps it across a sparse payload", () => {
    const store = useAgentCapabilitiesStore.getState();
    store.setCapabilities({ tier: 4, sim: true }, "node-a");
    store.setCapabilities({ tier: 4 }, "node-a");
    const state = useAgentCapabilitiesStore.getState();
    expect(selectDeviceCapabilities(state, "node-a")?.sim).toBe(true);
    expect(selectDeviceCapabilities(state, "node-b")?.sim).toBeUndefined();
  });
});
