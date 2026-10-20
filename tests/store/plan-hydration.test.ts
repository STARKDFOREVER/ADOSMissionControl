/**
 * The mission and plan library stores settle their hydration on a successful
 * read and on a rejected one, and say which it was, so a share link never
 * waits forever on stored plans that are not coming.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

function mockStorage(getItem: () => Promise<string | null>): void {
  vi.doMock("@/lib/storage", async () => {
    const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
    return {
      ...actual,
      indexedDBStorage: { storage: () => ({ getItem, setItem: async () => {}, removeItem: async () => {} }) },
    };
  });
}

async function loadStores() {
  const mission = await import("@/stores/mission-store");
  const library = await import("@/stores/plan-library-store");
  return { mission, library };
}

beforeEach(() => {
  vi.resetModules();
});

describe("mission and library hydration", () => {
  it("settles without failure when the stored plans load", async () => {
    mockStorage(async () => null);
    const { mission, library } = await loadStores();
    await vi.waitFor(() => {
      expect(mission.missionHydrationSettled()).toBe(true);
      expect(library.libraryHydrationSettled()).toBe(true);
    });
    expect(mission.missionHydrationFailed()).toBe(false);
    expect(library.libraryHydrationFailed()).toBe(false);
  });

  it("settles and reports the failure when the stored read rejects", async () => {
    mockStorage(() => Promise.reject(new Error("read failed")));
    const { mission, library } = await loadStores();
    await vi.waitFor(() => {
      expect(mission.missionHydrationSettled()).toBe(true);
      expect(library.libraryHydrationSettled()).toBe(true);
    });
    expect(mission.missionHydrationFailed()).toBe(true);
    expect(library.libraryHydrationFailed()).toBe(true);
    // zustand never marks a rejected read as hydrated.
    expect(mission.useMissionStore.persist.hasHydrated()).toBe(false);
  });
});
