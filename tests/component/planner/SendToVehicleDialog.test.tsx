/**
 * Send to vehicle dialog: only applicable items are offered, validation errors
 * block the mission, items run in order and a failure does not stop the rest.
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const mocks = vi.hoisted(() => ({ errors: [] as unknown[] }));

vi.mock("@/hooks/use-validation-options", () => ({ useValidationOptions: () => ({}) }));
vi.mock("@/lib/validation/mission-validator", () => ({ validateMission: () => ({ errors: mocks.errors, warnings: [] }) }));

import { SendToVehicleDialog } from "@/components/planner/SendToVehicleDialog";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import { usePlannerStore } from "@/stores/planner-store";
import { usePreflightChecklistStore } from "@/stores/preflight-checklist-store";
import { PREFLIGHT_ITEM_IDS } from "@/components/planner/preflight-items";

type DialogProps = ComponentProps<typeof SendToVehicleDialog>;

const calls: string[] = [];

function makePlanner(handleUpload: () => Promise<{ success: boolean; message: string }>) {
  return {
    waypoints: [
      { id: "w1", lat: 1, lon: 1, alt: 30, command: "WAYPOINT" },
      { id: "w2", lat: 1.001, lon: 1, alt: 30, command: "WAYPOINT" },
    ],
    handleUpload,
  } as unknown as DialogProps["p"];
}

function renderDialog(props: Partial<DialogProps> = {}) {
  const all: DialogProps = {
    open: true,
    onClose: vi.fn(),
    p: makePlanner(async () => { calls.push("mission"); return { success: true, message: "Mission uploaded to FC" }; }),
    showGeofence: true,
    showRally: true,
    ...props,
  };
  renderWithIntl(<SendToVehicleDialog {...all} />);
  return all;
}

beforeEach(() => {
  calls.length = 0;
  mocks.errors = [];
  useGeofenceStore.setState({
    fenceType: "polygon",
    polygonPoints: [[1, 1], [1, 1.01], [1.01, 1.01]],
    circleCenter: null,
    zones: [],
    uploadFence: vi.fn(async () => { calls.push("geofence"); return { success: false, message: "Fence rejected" }; }),
  });
  useRallyStore.setState({
    points: [{ id: "r1", lat: 1, lon: 1, alt: 40 }],
    uploadRallyPoints: vi.fn(async () => { calls.push("rally"); return { success: true, message: "Rally uploaded" }; }),
  });
  usePlannerStore.setState({ dockOpen: false, dockTab: "altitude" });
  usePreflightChecklistStore.setState({ checked: {} });
});
afterEach(cleanup);

describe("SendToVehicleDialog", () => {
  it("offers mission, geofence and rally when each is present", () => {
    renderDialog();
    expect(screen.getByLabelText("Mission (2 items)")).toBeChecked();
    expect(screen.getByLabelText("Geofence")).toBeChecked();
    expect(screen.getByLabelText("Rally points (1)")).toBeChecked();
  });

  it("hides geofence and rally when unsupported or empty", () => {
    useRallyStore.setState({ points: [] });
    renderDialog({ showGeofence: false });
    expect(screen.queryByLabelText("Geofence")).toBeNull();
    expect(screen.queryByLabelText(/Rally points/)).toBeNull();
  });

  it("runs selected items in order and continues after a failure", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toEqual(["mission", "geofence", "rally"]));
    await waitFor(() => {
      expect(within(screen.getByTestId("send-row-mission")).getByText("Sent")).toBeInTheDocument();
      expect(within(screen.getByTestId("send-row-geofence")).getByText("Failed")).toBeInTheDocument();
      expect(within(screen.getByTestId("send-row-geofence")).getByText("Fence rejected")).toBeInTheDocument();
      expect(within(screen.getByTestId("send-row-rally")).getByText("Sent")).toBeInTheDocument();
    });
  });

  it("keeps going when an item throws", async () => {
    renderDialog({ p: makePlanner(async () => { calls.push("mission"); throw new Error("link lost"); }) });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toEqual(["mission", "geofence", "rally"]));
    await waitFor(() => expect(within(screen.getByTestId("send-row-mission")).getByText("link lost")).toBeInTheDocument());
  });

  it("skips deselected items", async () => {
    renderDialog();
    fireEvent.click(screen.getByLabelText("Geofence"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toEqual(["mission", "rally"]));
  });

  it("blocks the mission on validation errors and links to the issues tab", async () => {
    mocks.errors = [{}];
    const { onClose } = renderDialog();
    const mission = screen.getByLabelText("Mission (2 items)");
    expect(mission).not.toBeChecked();
    expect(mission).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toEqual(["geofence", "rally"]));
    fireEvent.click(screen.getByRole("button", { name: "Review issues" }));
    expect(usePlannerStore.getState().dockOpen).toBe(true);
    expect(usePlannerStore.getState().dockTab).toBe("issues");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows checklist progress and opens the checklist tab", () => {
    usePreflightChecklistStore.setState({ checked: { [PREFLIGHT_ITEM_IDS[0]]: true } });
    const { onClose } = renderDialog();
    expect(screen.getByText(`Pre-flight checklist 1/${PREFLIGHT_ITEM_IDS.length}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open checklist" }));
    expect(usePlannerStore.getState().dockTab).toBe("checklist");
    expect(onClose).toHaveBeenCalled();
  });
});
