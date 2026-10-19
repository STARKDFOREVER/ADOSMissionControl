/**
 * @license GPL-3.0-only
 *
 * A multi-module node renders one card per ELRS module, read from the nested
 * wire shape (`link: {...}`) through the real normalizer; a single-lane node
 * keeps today's view with no module cards.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { RcElrsLinkTab } from "@/components/command/nodes/RcElrsLinkTab";
import { normalizeCrsf } from "@/stores/agent-capabilities/normalizer";
import messages from "../../../../../locales/en.json";

afterEach(cleanup);

function renderTab(raw: Record<string, unknown>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RcElrsLinkTab crsf={normalizeCrsf(raw)} />
    </NextIntlClientProvider>,
  );
}

describe("RcElrsLinkTab modules", () => {
  it("renders one card per module from the nested wire shape", () => {
    renderTab({
      state: "link_ok",
      modules: [
        { id: "m0", port: "/dev/ttyACM1", role: "pilot", connected: true, link: { rssi_dbm: [-60, -62], lq: 100, snr_db: 8, tx_power_mw: 250, rf_mode: "500Hz" } },
        { id: "m1", port: "/dev/ttyACM2", role: "autonomy", connected: false, link: { rssi_dbm: [], lq: null, snr_db: null, tx_power_mw: null, rf_mode: null } },
      ],
    });
    const m0 = screen.getByRole("group", { name: "m0" });
    expect(m0.textContent).toContain("Pilot");
    expect(m0.textContent).toContain("/dev/ttyACM1");
    expect(m0.textContent).toContain("100%");
    expect(m0.textContent).toContain("-62 dBm");
    expect(m0.textContent).toContain("8 dB");
    expect(m0.textContent).toContain("250 mW");
    expect(m0.textContent).toContain("500Hz");
    const m1 = screen.getByRole("group", { name: "m1" });
    expect(m1.textContent).toContain("Autonomy");
    expect(m1.textContent).toContain("Disconnected");
    expect(m1.textContent).not.toContain("0 mW");
  });

  it("keeps the single-lane view when no modules are reported", () => {
    renderTab({ state: "link_ok", txPowerMw: 100 });
    expect(screen.queryByText("ELRS modules")).toBeNull();
    expect(screen.getByText("100 mW")).toBeTruthy();
  });
});
