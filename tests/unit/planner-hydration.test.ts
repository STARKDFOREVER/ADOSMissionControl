/**
 * A failed read of the persisted planner state must still settle hydration,
 * so the map reports its view and the controls waiting on it come alive.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { plannerHydrationSettled, usePlannerStore } from "@/stores/planner-store";

vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    indexedDBStorage: {
      storage: () => ({
        getItem: () => Promise.reject(new Error("read failed")),
        setItem: async () => {},
        removeItem: async () => {},
      }),
    },
  };
});

describe("planner hydration", () => {
  it("settles when the persisted read rejects", async () => {
    await vi.waitFor(() => expect(plannerHydrationSettled()).toBe(true));
    // zustand never marks a rejected read as hydrated; the settled flag is
    // what carries the error path.
    expect(usePlannerStore.persist.hasHydrated()).toBe(false);
  });
});
