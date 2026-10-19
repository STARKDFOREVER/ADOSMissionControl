/**
 * @module node-detail/surfaces/device
 * @description The DEVICE band every node with a physical box shares: its
 * local display, front-panel buttons and peripherals. A ground station and a
 * Visor both carry one, so both profiles list these same surfaces; the agent
 * serves the same display / button / peripheral routes on either. They carry
 * no `order`: a profile that wants extension pages interleaved assigns it.
 * @license GPL-3.0-only
 */

import dynamic from "next/dynamic";
import type { SurfaceSpec } from "../surface-types";
import { surfaceNodeDeviceId } from "../surface-types";
import { DEVICE_GROUP } from "../surface-groups";

// Every tab body loads on first open: the panel renders one at a time.
const DisplayTab = dynamic(() =>
  import("@/components/command/nodes/device/DisplayTab").then((m) => m.DisplayTab),
);
const PhysicalUiTab = dynamic(() =>
  import("@/components/command/nodes/device/PhysicalUiTab").then((m) => m.PhysicalUiTab),
);
const PeripheralsTab = dynamic(() =>
  import("@/components/command/nodes/device/PeripheralsTab").then((m) => m.PeripheralsTab),
);

export const DEVICE_SURFACES: SurfaceSpec[] = [
  {
    id: "display",
    labelKey: "command.groundStation.tabs.display",
    group: DEVICE_GROUP,
    render: (ctx) => <DisplayTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  {
    id: "physicalUi",
    labelKey: "dronePanel.buttons",
    group: DEVICE_GROUP,
    render: (ctx) => <PhysicalUiTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  {
    id: "peripherals",
    labelKey: "command.groundStation.tabs.peripherals",
    group: DEVICE_GROUP,
    render: (ctx) => <PeripheralsTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
];
