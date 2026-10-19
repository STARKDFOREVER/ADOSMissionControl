/**
 * Rally editor: the coordinate fields follow the point (a map drag is not
 * reverted by a later blur), and removing or clearing points is one undo step
 * behind a confirmation.
 * @license GPL-3.0-only
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => {}),
      removeItem: vi.fn(async () => {}),
    }),
  },
}));

import { RallyPointEditor } from "@/components/planner/RallyPointEditor";
import { useRallyStore } from "@/stores/rally-store";
import { clearHistory, undoHistory } from "@/lib/planner-history";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const R1 = { id: "r1", lat: 12.97, lon: 77.59, alt: 30 };
const R2 = { id: "r2", lat: 12.98, lon: 77.6, alt: 40 };

beforeEach(() => {
  clearHistory();
  useRallyStore.setState({ points: [R1] });
});
afterEach(cleanup);

describe("RallyPointEditor", () => {
  it("shows a map-dragged position and keeps it when the fields blur", () => {
    renderWithIntl(<RallyPointEditor />);
    act(() => { useRallyStore.getState().updatePoint("r1", { lat: -33.8568, lon: 151.2153 }); });

    const lat = screen.getByLabelText("Latitude") as HTMLInputElement;
    const lon = screen.getByLabelText("Longitude") as HTMLInputElement;
    expect(lat.value).toBe("-33.8568");
    fireEvent.focus(lat); fireEvent.blur(lat);
    fireEvent.focus(lon); fireEvent.blur(lon);

    expect(useRallyStore.getState().points[0]).toMatchObject({ lat: -33.8568, lon: 151.2153 });
  });

  it("clears only after confirmation, and undo restores the points", () => {
    renderWithIntl(<RallyPointEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(useRallyStore.getState().points).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(useRallyStore.getState().points).toHaveLength(0);

    act(() => undoHistory());
    expect(useRallyStore.getState().points).toEqual([R1]);
  });

  it("highlights the focused row", () => {
    useRallyStore.setState({ points: [R1, R2] });
    const { container } = renderWithIntl(<RallyPointEditor focusId="r2" />);
    const current = container.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Rally 2");
  });
});
