/**
 * Landing editors: the approach heading is optional, so emptying the field
 * and committing clears it back to "not set" and the required warning returns.
 * @license GPL-3.0-only
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => {}),
      removeItem: vi.fn(async () => {}),
    }),
  },
}));

import { FixedWingLandingConfig } from "@/components/planner/FixedWingLandingConfigSection";
import { VtolLandingConfig } from "@/components/planner/VtolLandingConfigSection";
import { usePatternStore } from "@/stores/pattern-store";

beforeEach(() => {
  usePatternStore.setState({
    fixedWingLandingConfig: { approachHeading: 90 },
    vtolLandingConfig: { approachHeading: 90 },
  });
});
afterEach(cleanup);

function clearHeading() {
  const field = screen.getByLabelText("approachHeading");
  fireEvent.change(field, { target: { value: "" } });
  fireEvent.blur(field);
}

describe("landing approach heading", () => {
  it("fixed-wing: clearing the heading writes undefined and shows the warning", () => {
    render(<FixedWingLandingConfig />);
    expect(screen.queryByText("approachHeadingRequired")).toBeNull();
    clearHeading();
    expect(usePatternStore.getState().fixedWingLandingConfig.approachHeading).toBeUndefined();
    expect(screen.getByText("approachHeadingRequired")).toBeInTheDocument();
  });

  it("VTOL: clearing the heading writes undefined", () => {
    render(<VtolLandingConfig />);
    clearHeading();
    expect(usePatternStore.getState().vtolLandingConfig.approachHeading).toBeUndefined();
    expect(screen.getByText("approachHeadingRequired")).toBeInTheDocument();
  });
});
