/**
 * Pattern inspector: a pattern number field keeps what the operator types
 * (an emptied field never writes the default back) and commits on blur, and
 * "Draw area" arms the matching draw tool tagged for the pattern.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import { PatternInspector } from "@/components/planner/inspector/PatternInspector";
import type { Planner } from "@/app/plan/use-planner";
import { usePatternStore } from "@/stores/pattern-store";
import { usePlannerStore } from "@/stores/planner-store";
import { selectPatternType } from "@/stores/pattern-selection";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const p = { handlePatternApply: vi.fn() } as unknown as Planner;

beforeEach(() => {
  usePatternStore.getState().clear();
  usePlannerStore.getState().setActiveTool("select");
});
afterEach(cleanup);

describe("PatternInspector", () => {
  it("does not snap an emptied number field to its default while typing", () => {
    selectPatternType("orbit");
    usePatternStore.getState().updateOrbitConfig({ radius: 120 });
    renderWithIntl(<PatternInspector p={p} />);

    const radius = screen.getByRole("spinbutton", { name: "Radius" }) as HTMLInputElement;
    fireEvent.change(radius, { target: { value: "" } });
    expect(radius.value).toBe("");
    expect(usePatternStore.getState().orbitConfig.radius).toBe(120);

    fireEvent.change(radius, { target: { value: "7" } });
    expect(usePatternStore.getState().orbitConfig.radius).toBe(120);
    fireEvent.blur(radius);
    expect(usePatternStore.getState().orbitConfig.radius).toBe(7);
  });

  it("Draw area arms a circle draw for orbit and a polygon draw for survey", () => {
    selectPatternType("orbit");
    const { unmount } = renderWithIntl(<PatternInspector p={p} />);
    fireEvent.click(screen.getByRole("button", { name: "Draw area" }));
    expect(usePlannerStore.getState().mode).toEqual({ kind: "draw", shape: "circle", drawingFor: "pattern" });
    unmount();

    selectPatternType("survey");
    renderWithIntl(<PatternInspector p={p} />);
    fireEvent.click(screen.getByRole("button", { name: "Draw area" }));
    expect(usePlannerStore.getState().mode).toEqual({ kind: "draw", shape: "polygon", drawingFor: "pattern" });
  });

  it("has no Draw area for a point-origin pattern", () => {
    selectPatternType("expandingSquare");
    renderWithIntl(<PatternInspector p={p} />);
    expect(screen.queryByRole("button", { name: "Draw area" })).toBeNull();
  });
});
