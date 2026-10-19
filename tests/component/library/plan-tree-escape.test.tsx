/**
 * Escape in a plan-library menu closes that menu (or cancels its rename) and
 * nothing else: the planner listens for Escape on `document` to close the
 * plans sheet, and must not see a key the menu consumed.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { PlanFolder } from "@/lib/types";

vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import { PlanTree } from "@/components/library/PlanTree";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const FOLDER: PlanFolder = { id: "f1", name: "Survey runs", parentId: null, createdAt: 0, order: 0 };

function renderTree() {
  return renderWithIntl(
    <PlanTree plans={[]} folders={[FOLDER]} activePlanId={null} isDirty={false}
      expandedFolders={["f1"]} context="plan" onSelect={() => {}} />,
  );
}

describe("plan library menus and Escape", () => {
  const plannerEscape = vi.fn();
  const onDocKey = (e: KeyboardEvent) => { if (e.key === "Escape") plannerEscape(); };

  beforeEach(() => {
    plannerEscape.mockReset();
    usePlanLibraryStore.setState({ folders: [FOLDER] });
    document.addEventListener("keydown", onDocKey);
  });
  afterEach(() => {
    document.removeEventListener("keydown", onDocKey);
    cleanup();
  });

  it("closes the folder menu without the planner seeing the key", () => {
    renderTree();
    fireEvent.click(screen.getByTitle("More actions"));
    expect(screen.getByText("Rename")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByText("Rename")).toBeNull();
    expect(plannerEscape).not.toHaveBeenCalled();
  });

  it("cancels a folder rename without renaming or reaching the planner", () => {
    renderTree();
    fireEvent.click(screen.getByTitle("More actions"));
    fireEvent.click(screen.getByText("Rename"));
    const input = screen.getByDisplayValue("Survey runs");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByDisplayValue("Renamed")).toBeNull();
    expect(usePlanLibraryStore.getState().folders[0].name).toBe("Survey runs");
    expect(plannerEscape).not.toHaveBeenCalled();
  });

  it("lets Escape through once no menu is open", () => {
    renderTree();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(plannerEscape).toHaveBeenCalledTimes(1);
  });
});
