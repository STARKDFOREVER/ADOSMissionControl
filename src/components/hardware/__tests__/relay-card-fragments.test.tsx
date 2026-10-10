/**
 * @module hardware/relay-card-fragments.test
 * @description A relay whose forwarded-fragment count was not measured
 * renders "—", never a fabricated 0.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => Object.assign((k: string) => k, { rich: (k: string) => k }),
}));

import { RelayCard } from "../RelayCard";

describe("RelayCard fragments", () => {
  it("renders — when fragments is null", () => {
    render(<RelayCard relay={{ mac: "aa:bb:cc:00:11:04", last_seen_ms: 0, fragments: null }} />);
    expect(screen.getByText(/— fragments/)).toBeDefined();
  });

  it("renders the measured count", () => {
    render(<RelayCard relay={{ mac: "aa:bb:cc:00:11:02", last_seen_ms: 0, fragments: 42 }} />);
    expect(screen.getByText(/42 fragments/)).toBeDefined();
  });
});
