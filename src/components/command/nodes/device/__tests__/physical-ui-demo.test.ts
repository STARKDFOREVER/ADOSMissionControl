/**
 * @license GPL-3.0-only
 *
 * Demo mode's panel config per profile: a ground station shows the seeded
 * ground-station config, a Visor its own defaults (REC/MARK pass-through, the
 * power-off long press, the capture HUD first), never the ground-station seed.
 */

import { describe, expect, it } from "vitest";
import { PANEL_BUTTON_DEFAULTS, type UiConfig } from "@/lib/api/ground-station/types/ui";
import { demoUi } from "../PhysicalUiTab";

const GS_SEED: UiConfig = {
  oled: { brightness: 180 },
  buttons: { mapping: { ...PANEL_BUTTON_DEFAULTS.ground_station } },
  screens: { order: ["link", "uplink"], enabled: ["link", "uplink"] },
};

describe("demoUi", () => {
  it("shows the seed on a ground station", () => {
    expect(demoUi(GS_SEED, "ground_station")).toBe(GS_SEED);
  });

  it("shows a Visor's own defaults, not the ground-station seed", () => {
    const ui = demoUi(GS_SEED, "visor")!;
    expect(ui.buttons.mapping).toMatchObject({
      B1_short: "passthrough",
      B2_short: "passthrough",
      B1_long: "shutdown_prompt",
    });
    expect(ui.screens.order[0]).toBe("plugin:capture_hud");
    expect(ui.oled.brightness).toBe(180);
  });
});
