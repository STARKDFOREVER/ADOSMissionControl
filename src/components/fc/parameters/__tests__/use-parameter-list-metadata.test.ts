import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { create } from "zustand";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

interface FakeDrone {
  protocol: object;
  vehicleInfo: { firmwareType: string; vehicleClass: string; firmwareVersionString: string };
}
interface FakeManager {
  selectedDroneId: string | null;
  drones: Map<string, FakeDrone>;
  getSelectedDrone: () => FakeDrone | undefined;
}

const fakeManager = create<FakeManager>()((_set, get) => ({
  selectedDroneId: null,
  drones: new Map(),
  getSelectedDrone: () => {
    const id = get().selectedDroneId;
    return id ? get().drones.get(id) : undefined;
  },
}));

vi.mock("@/stores/drone-manager", () => ({
  get useDroneManager() {
    return fakeManager;
  },
}));
vi.mock("@/stores/param-list-cache", () => ({
  beginParamDownload: vi.fn(),
  commitParamDownload: vi.fn(),
  getCachedParamList: () => [],
  updateCachedParamList: vi.fn(),
}));

const pending = new Map<string, (m: Map<string, unknown>) => void>();
vi.mock("@/lib/protocol/param-metadata", () => ({
  loadParamMetadata: (opts: { firmwareType: string }) => {
    const { promise, resolve } = Promise.withResolvers<Map<string, unknown>>();
    pending.set(opts.firmwareType, resolve);
    return promise;
  },
}));

import { useParameterList } from "../use-parameter-list";

function drone(fw: string): FakeDrone {
  return {
    protocol: {},
    vehicleInfo: { firmwareType: fw, vehicleClass: "copter", firmwareVersionString: "1" },
  };
}

describe("useParameterList metadata", () => {
  it("keeps the last selection's metadata when an older load resolves late", async () => {
    fakeManager.setState({
      drones: new Map([
        ["a", drone("fw-a")],
        ["b", drone("fw-b")],
      ]),
      selectedDroneId: "a",
    });
    const { result } = renderHook(() => useParameterList(() => {}));
    act(() => {
      fakeManager.setState({ selectedDroneId: "b" });
    });

    const metaB = new Map([["B_PARAM", {}]]);
    const metaA = new Map([["A_PARAM", {}]]);
    await act(async () => {
      pending.get("fw-b")!(metaB);
      await Promise.resolve();
    });
    await act(async () => {
      pending.get("fw-a")!(metaA);
      await Promise.resolve();
    });
    expect(result.current.metadata).toBe(metaB);
  });
});
