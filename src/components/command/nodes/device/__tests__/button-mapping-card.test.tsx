/**
 * @license GPL-3.0-only
 *
 * The front-panel button pickers: the node's wire mapping drives one picker
 * per press, the plugin pass-through and power-off actions are offered and
 * labelled in every locale, and an action this app does not know keeps its
 * raw name instead of being rewritten.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../locales/en.json";
import { PANEL_BUTTON_ACTIONS } from "@/lib/api/ground-station/types/ui";
import { ButtonMappingCard } from "../ButtonMappingCard";

afterEach(cleanup);

const LOCALES = join(__dirname, "../../../../../../locales");

const VISOR_MAPPING = {
  B1_short: "passthrough",
  B1_long: "shutdown_prompt",
  B2_short: "passthrough",
  B2_long: "passthrough",
  B3_short: "cycle_screen",
  B3_long: "passthrough",
  B4_short: "back",
  B4_long: "vendor_custom",
};

function renderCard(mapping: Record<string, string> | null) {
  const onSave = vi.fn(async () => {});
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ButtonMappingCard mapping={mapping} onSave={onSave} />
    </NextIntlClientProvider>,
  );
  return onSave;
}

describe("ButtonMappingCard", () => {
  it("offers pass-through and the power-off prompt and shows the node's mapping", () => {
    expect(PANEL_BUTTON_ACTIONS).toContain("passthrough");
    expect(PANEL_BUTTON_ACTIONS).toContain("shutdown_prompt");
    renderCard(VISOR_MAPPING);
    expect(screen.getAllByText("Plugin pass-through")).toHaveLength(4);
    expect(screen.getByText("Power-off prompt")).toBeTruthy();
    expect(screen.getByText("Next screen")).toBeTruthy();
    // An action the app has no label for stays under its raw name.
    expect(screen.getByText("vendor_custom")).toBeTruthy();
    // Nothing edited yet: nothing to save.
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  it("says the mapping is unread before the node answers", () => {
    renderCard(null);
    expect(screen.getByText("The button mapping has not been read from this node yet.")).toBeTruthy();
  });

  it("labels every action in every locale", () => {
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
