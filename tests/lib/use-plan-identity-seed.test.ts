/**
 * Tests for the planner's plan identity seed: the page-state name and vehicle
 * follow the active library plan, a first mount keeps a name the page already
 * holds, and closing the plan clears them.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useState } from "react";
import { usePlanIdentitySeed } from "@/app/plan/use-plan-identity-seed";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import type { SavedPlan } from "@/lib/types";

function plan(id: string, name: string, droneId?: string): SavedPlan {
  return {
    id,
    name,
    folderId: null,
    waypoints: [],
    metadata: droneId ? { droneId } : {},
    frame: "relative",
    createdAt: 0,
    updatedAt: 0,
  };
}

function useHarness(activePlanId: string | null, initialName = "") {
  const [name, setName] = useState(initialName);
  const [drone, setDrone] = useState("");
  usePlanIdentitySeed(activePlanId, setName, setDrone);
  return { name, drone };
}

describe("usePlanIdentitySeed", () => {
  beforeEach(() => {
    usePlanLibraryStore.setState({ plans: [plan("A", "Alpha", "d1"), plan("B", "Bravo")] });
  });

  it("follows the active plan and clears when it closes", () => {
    const { result, rerender } = renderHook(({ id }) => useHarness(id), {
      initialProps: { id: "A" as string | null },
    });
    expect(result.current).toEqual({ name: "Alpha", drone: "d1" });

    rerender({ id: "B" });
    expect(result.current).toEqual({ name: "Bravo", drone: "" });

    rerender({ id: null });
    expect(result.current).toEqual({ name: "", drone: "" });
  });

  it("keeps a name the page already holds on first mount", () => {
    const { result } = renderHook(() => useHarness("A", "Shared"));
    expect(result.current.name).toBe("Shared");
  });

  it("keeps a name the page holds when the library hydrates after mount", () => {
    const { result, rerender } = renderHook(({ id }) => useHarness(id, "Shared"), {
      initialProps: { id: null as string | null },
    });
    rerender({ id: "A" });
    expect(result.current).toEqual({ name: "Shared", drone: "d1" });
  });

  it("an active id the library does not hold leaves the identity alone", () => {
    const { result, rerender } = renderHook(({ id }) => useHarness(id, "Kept"), {
      initialProps: { id: "gone" as string | null },
    });
    expect(result.current.name).toBe("Kept");
    // The missing plan is not retried: a later switch is a plan-to-plan change.
    rerender({ id: "B" });
    expect(result.current).toEqual({ name: "Bravo", drone: "" });
  });
});
