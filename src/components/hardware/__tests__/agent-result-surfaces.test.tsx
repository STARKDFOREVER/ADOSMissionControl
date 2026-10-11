/**
 * The recorder's segment list with its interruption count, and the uplink
 * panel's "Route not applied" warning fed by the router's route verdict.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (k: string, v?: Record<string, unknown>) =>
      v && "count" in v ? `${k}:${String(v.count)}` : k,
}));

import { RecordingResultList } from "../RecordingResultList";
import { UplinkPriorityPanel } from "../network/UplinkPriorityPanel";
import { applyUplinkEvent } from "@/stores/ground-station/uplink-ws";
import { INITIAL_UPLINK } from "@/stores/ground-station/initial-state";

describe("RecordingResultList", () => {
  it("lists every segment and the interruption count", () => {
    render(
      <RecordingResultList
        result={{
          filename: "rec_a.mp4",
          segments: ["rec_a.mp4", "rec_a_part2.mp4"],
          interrupted_count: 1,
        }}
      />,
    );
    expect(screen.getByText("lastResult:2")).toBeDefined();
    expect(screen.getByText("interrupted:1")).toBeDefined();
    expect(screen.getByText("rec_a_part2.mp4")).toBeDefined();
  });

  it("omits the interruption line for an unbroken capture", () => {
    render(<RecordingResultList result={{ filename: "rec_b.mp4", segments: ["rec_b.mp4"], interrupted_count: 0 }} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("uplink route verdict", () => {
  const live = {
    kind: "health_changed",
    active_uplink: "ethernet",
    available: ["ethernet"],
    internet_reachable: true,
    data_cap_state: null,
    timestamp_ms: 1,
    stale: false,
  };

  it("folds route_applied from the uplink frame and keeps it when absent", () => {
    const off = applyUplinkEvent(INITIAL_UPLINK, { ...live, route_applied: false }, 10);
    if (!off) throw new Error("the live frame folds");
    expect(off.routeApplied).toBe(false);
    expect(applyUplinkEvent(off, live, 20)?.routeApplied).toBe(false);
    expect(applyUplinkEvent(off, { ...live, stale: true }, 30)?.routeApplied).toBeNull();
  });

  it("warns when the active uplink's route is not applied", () => {
    render(
      <UplinkPriorityPanel
        uplink={{ active: "ethernet", priority: ["ethernet"], failover_log: [], routeApplied: false }}
        shareEnabled={false}
        onPriorityChange={() => {}}
        onShareToggle={() => {}}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Route not applied");
  });

  it("does not warn when the route is applied", () => {
    render(
      <UplinkPriorityPanel
        uplink={{ active: "ethernet", priority: ["ethernet"], failover_log: [], routeApplied: true }}
        shareEnabled={false}
        onPriorityChange={() => {}}
        onShareToggle={() => {}}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
