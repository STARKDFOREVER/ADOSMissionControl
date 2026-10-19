/**
 * @license GPL-3.0-only
 *
 * The front-panel button pickers: the node's wire mapping drives one picker
 * per press over the profile's defaults, the plugin pass-through and
 * power-off actions are offered and labelled in every locale, an action this
 * app does not know keeps its raw name, and a save carries only the presses
 * that differ from the profile defaults.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../locales/en.json";
import {
  PANEL_BUTTON_ACTIONS,
  PANEL_BUTTON_DEFAULTS,
  buttonOverrides,
  type PanelProfile,
} from "@/lib/api/ground-station/types/ui";
import { ButtonMappingCard } from "../ButtonMappingCard";

afterEach(cleanup);

const LOCALES = join(__dirname, "../../../../../../locales");

function renderCard(profile: PanelProfile, mapping: Record<string, string> | null) {
  const onSave = vi.fn(async (_overrides: Record<string, string>) => {});
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ButtonMappingCard profile={profile} mapping={mapping} onSave={onSave} />
    </NextIntlClientProvider>,
  );
  return onSave;
}

describe("buttonOverrides", () => {
  it("keeps only the presses that differ from the profile defaults", () => {
    expect(buttonOverrides({ ...PANEL_BUTTON_DEFAULTS.visor }, "visor")).toEqual({});
    expect(
      buttonOverrides({ ...PANEL_BUTTON_DEFAULTS.visor, B4_long: "menu" }, "visor"),
    ).toEqual({ B4_long: "menu" });
    // The same press is a default on one profile and an override on the other.
    expect(buttonOverrides({ B1_short: "passthrough" }, "ground_station")).toEqual({
      B1_short: "passthrough",
    });
  });
});

describe("ButtonMappingCard", () => {
  it("shows a Visor's defaults: pass-through REC/MARK and the power-off prompt", () => {
    renderCard("visor", { ...PANEL_BUTTON_DEFAULTS.visor });
    expect(screen.getAllByText("Plugin pass-through")).toHaveLength(5);
    expect(screen.getByText("Power-off prompt")).toBeTruthy();
    expect(screen.getByText("Next screen")).toBeTruthy();
    // Nothing edited yet: nothing to save.
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  it("fills unread presses from the profile defaults and keeps an unknown action's raw name", () => {
    renderCard("ground_station", { B4_long: "vendor_custom" });
    expect(screen.getByText("vendor_custom")).toBeTruthy();
    expect(screen.getByText("Toggle backlight")).toBeTruthy();
  });

  it("saves only the presses that differ from the profile defaults", async () => {
    const onSave = renderCard("visor", { ...PANEL_BUTTON_DEFAULTS.visor });
    fireEvent.click(screen.getByLabelText("B4 Long press action"));
    fireEvent.click(screen.getByRole("option", { name: "Menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ B4_long: "menu" }));
  });

  it("says the mapping is unread before the node answers", () => {
    renderCard("visor", null);
    expect(screen.getByText("The button mapping has not been read from this node yet.")).toBeTruthy();
  });

  it("labels every action in every locale", () => {
    expect(PANEL_BUTTON_ACTIONS).toContain("passthrough");
    expect(PANEL_BUTTON_ACTIONS).toContain("shutdown_prompt");
    for (const file of readdirSync(LOCALES).filter((f) => f.endsWith(".json"))) {
      const locale = JSON.parse(readFileSync(join(LOCALES, file), "utf-8")) as {
        hardware: { buttons: { actions: Record<string, string> } };
      };
      for (const action of PANEL_BUTTON_ACTIONS) {
        expect(locale.hardware.buttons.actions[action], `${file} ${action}`).toBeTruthy();
      }
    }
  });
});
