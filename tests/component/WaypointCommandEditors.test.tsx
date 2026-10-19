/**
 * Component tests for the per-command parameter editors: each field must
 * commit to the model slot that expands into the right MAVLink parameter, and
 * an emptied field clears its slot.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import {
  CommandSpecificEditors,
  INavCommandEditors,
} from "@/components/planner/WaypointCommandEditors";
import { renderWithIntl } from "../helpers/intl-wrapper";

const noop = () => {};

/** Type a value into the named field and blur it. */
function enter(name: RegExp, value: string) {
  const input = screen.getByRole("spinbutton", { name });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe("CommandSpecificEditors slot routing", () => {
  it("LOITER_TURNS turns commit to holdTime (MAVLink param1) and radius to param2 (MAVLink param3)", () => {
    const onUpdate = vi.fn();
    const onHoldTime = vi.fn();
    renderWithIntl(<CommandSpecificEditors cmd="LOITER_TURNS" params={{}} onUpdate={onUpdate} onHoldTime={onHoldTime} />);
    enter(/Turns/i, "3");
    enter(/Radius/i, "22");
    expect(onHoldTime.mock.calls).toEqual([[3]]);
    expect(onUpdate.mock.calls).toEqual([[{ param2: 22 }]]);
  });

  it("PAYLOAD_PLACE max descent commits to holdTime (MAVLink param1)", () => {
    const onHoldTime = vi.fn();
    renderWithIntl(<CommandSpecificEditors cmd="NAV_PAYLOAD_PLACE" params={{}} onUpdate={noop} onHoldTime={onHoldTime} />);
    enter(/Max descent/i, "12");
    expect(onHoldTime.mock.calls).toEqual([[12]]);
  });

  it("clearing a set parameter clears its slot", () => {
    const onUpdate = vi.fn();
    renderWithIntl(<CommandSpecificEditors cmd="WAYPOINT" params={{ param1: 4 }} onUpdate={onUpdate} onHoldTime={noop} />);
    enter(/Accept radius/i, "");
    expect(onUpdate.mock.calls).toEqual([[{ param1: undefined }]]);
  });
});

describe("CommandSpecificEditors truthful fields", () => {
  it("offers a hold time where the flight controller waits, never on an unlimited loiter", () => {
    for (const cmd of ["WAYPOINT", "LOITER_TIME", "SPLINE_WAYPOINT"]) {
      const { unmount } = renderWithIntl(<CommandSpecificEditors cmd={cmd} params={{}} onUpdate={noop} onHoldTime={noop} />);
      expect(screen.queryByRole("spinbutton", { name: /Hold time/i })).not.toBeNull();
      unmount();
    }
    renderWithIntl(<CommandSpecificEditors cmd="LOITER" params={{}} onUpdate={noop} onHoldTime={noop} />);
    expect(screen.queryByRole("spinbutton", { name: /Hold time/i })).toBeNull();
  });

  it("never offers a hold time for an attached action", () => {
    renderWithIntl(<CommandSpecificEditors cmd="WAYPOINT" params={{}} onUpdate={noop} />);
    expect(screen.queryByRole("spinbutton", { name: /Hold time/i })).toBeNull();
  });

  it("shows a fence action with no param1 (a downloaded fence-disable) as Disable", () => {
    renderWithIntl(<CommandSpecificEditors cmd="DO_FENCE_ENABLE" params={{}} onUpdate={noop} />);
    const group = screen.getByRole("radiogroup", { name: /Fence/i });
    const checked = Array.from(group.querySelectorAll('[role="radio"][aria-checked="true"]'));
    expect(checked.map((el) => el.textContent)).toEqual(["Disable"]);
  });
});

describe("INavCommandEditors slot routing", () => {
  it("LAND site elevation commits to param1, which expands to MAVLink param2 (iNav p2)", () => {
    const onUpdate = vi.fn();
    renderWithIntl(<INavCommandEditors cmd="LAND" params={{}} onUpdate={onUpdate} onHoldTime={noop} />);
    enter(/Elevation/i, "12");
    expect(onUpdate.mock.calls).toEqual([[{ param1: 12 }]]);
  });

  it("POSHOLD_TIME hold time commits to holdTime (MAVLink param1, iNav p1)", () => {
    const onHoldTime = vi.fn();
    renderWithIntl(<INavCommandEditors cmd="LOITER_TIME" params={{}} onUpdate={noop} onHoldTime={onHoldTime} />);
    enter(/Hold time/i, "30");
    expect(onHoldTime.mock.calls).toEqual([[30]]);
  });
});
