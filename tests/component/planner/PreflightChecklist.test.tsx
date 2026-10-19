/**
 * Component tests for the planner pre-flight checklist: ticks are written to
 * the shared session store (so other surfaces can read the count) and Clear
 * unticks everything.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";
import { PreflightChecklist } from "@/components/planner/PreflightChecklist";
import { usePreflightChecklistStore } from "@/stores/preflight-checklist-store";
import { PREFLIGHT_ITEM_IDS, countCheckedPreflightItems } from "@/components/planner/preflight-items";
import { DEFAULT_CHECKLIST } from "@/lib/preflight-checklist";

beforeEach(() => usePreflightChecklistStore.getState().clear());

describe("PreflightChecklist", () => {
  it("lists every checklist item id", () => {
    expect(PREFLIGHT_ITEM_IDS).toEqual(DEFAULT_CHECKLIST.map((i) => i.id));
    renderWithIntl(<PreflightChecklist />);
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(PREFLIGHT_ITEM_IDS.length);
  });

  it("writes ticks to the store and shows progress", () => {
    renderWithIntl(<PreflightChecklist />);
    fireEvent.click(screen.getByRole("button", { name: "GPS lock acquired" }));
    expect(usePreflightChecklistStore.getState().checked.gpsLock).toBe(true);
    expect(countCheckedPreflightItems(usePreflightChecklistStore.getState().checked)).toBe(1);
    expect(screen.getByText(`1/${PREFLIGHT_ITEM_IDS.length}`)).toBeDefined();
  });

  it("renders ticks already in the store and clears them", () => {
    usePreflightChecklistStore.getState().toggle("propsSecure");
    renderWithIntl(<PreflightChecklist />);
    const item = screen.getByRole("button", { name: "Propellers fitted and secure" });
    expect(item.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(usePreflightChecklistStore.getState().checked).toEqual({});
    expect(item.getAttribute("aria-pressed")).toBe("false");
  });

  it("reports ready once every item is ticked", () => {
    for (const id of PREFLIGHT_ITEM_IDS) usePreflightChecklistStore.getState().toggle(id);
    renderWithIntl(<PreflightChecklist />);
    expect(screen.getByText("Ready")).toBeDefined();
  });
});
