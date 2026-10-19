/**
 * POI editor: a focus request from the parent selects that point and
 * highlights its row.
 * @license GPL-3.0-only
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => {}),
      removeItem: vi.fn(async () => {}),
    }),
  },
}));

import { PoiEditor } from "@/components/planner/PoiEditor";
import { usePlanPoiStore } from "@/stores/plan-poi-store";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const P1 = { id: "p1", lat: 12.97, lon: 77.59, label: "Tower" };
const P2 = { id: "p2", lat: 12.98, lon: 77.6, label: "Gate" };

beforeEach(() => {
  usePlanPoiStore.setState({ points: [P1, P2], selectedId: null });
});
afterEach(cleanup);

describe("PoiEditor", () => {
  it("selects and highlights the focused point", () => {
    const { container } = renderWithIntl(<PoiEditor focusId="p2" />);
    expect(usePlanPoiStore.getState().selectedId).toBe("p2");
    const current = container.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Gate");
  });
});
