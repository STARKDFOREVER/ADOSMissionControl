/**
 * The outline waypoint row labels a relative altitude as above home and shows
 * the real ground clearance under the waypoint, coloured by that clearance.
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import type { Waypoint } from "@/lib/types";
import { OutlineWaypointRow } from "@/components/planner/outline/OutlineWaypointRow";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const noop = () => {};

/** Launch point on 100 m ground. */
const HOME_GROUND = 100;

function renderRow(waypoint: Waypoint) {
  return renderWithIntl(
    <OutlineWaypointRow
      waypoint={waypoint} index={1} selected={false} multiSelected={false} isInav={false}
      defaultFrame="relative" homeGroundElevation={HOME_GROUND}
      onClick={noop} onRemove={noop} onDragStart={noop} onDragOver={noop} onDragEnd={noop}
      onDrop={noop} dragOver={false} registerRow={noop}
    />,
  );
}

beforeEach(() => cleanup());

describe("OutlineWaypointRow altitude labels", () => {
  it("badges a relative altitude as above home, not above ground", () => {
    renderRow({ id: "w", lat: 12.98, lon: 77.6, alt: 50 });
    expect(screen.getByText("REL")).toBeTruthy();
    expect(screen.queryByText("AGL")).toBeNull();
  });

  it("shows the real clearance over a ridge higher than home, in the error colour", () => {
    // 50 m above a 100 m home is 150 m MSL: 30 m below the 180 m ridge.
    renderRow({ id: "w", lat: 12.98, lon: 77.6, alt: 50, groundElevation: 180 });
    const chip = screen.getByTitle("-30m AGL (ground: 180m)");
    expect(chip.className).toContain("text-status-error");
  });

  it("measures an absolute (MSL) altitude against the ground below it", () => {
    renderRow({ id: "w", lat: 12.98, lon: 77.6, alt: 500, frame: "absolute", groundElevation: 180 });
    expect(screen.getByText("MSL")).toBeTruthy();
    const chip = screen.getByTitle("320m AGL (ground: 180m)");
    expect(chip.className).not.toContain("text-status-error");
    expect(chip.className).not.toContain("text-status-warning");
  });

  it("does not paint a landing row below home ground as a hazard (the validator exempts it)", () => {
    renderRow({ id: "w", lat: 12.98, lon: 77.6, alt: 0, command: "LAND", groundElevation: 102 });
    const chip = screen.getByTitle("-2m AGL (ground: 102m)");
    expect(chip.className).not.toContain("text-status-error");
    expect(chip.className).toContain("text-text-tertiary");
  });
});
