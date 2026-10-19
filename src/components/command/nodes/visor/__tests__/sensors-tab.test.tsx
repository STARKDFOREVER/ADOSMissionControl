/**
 * @license GPL-3.0-only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../../locales/en.json";
import { SensorsTab } from "../SensorsTab";
import { rateLevel, sigmaMs } from "../sensor-format";
import { useNodeSensorsStore } from "@/stores/node-sensors-store";
import { DEMO_VISOR, DEMO_VISOR_SENSORS, seedVisorReadings } from "@/mock/demo-seed/visor";
import type * as SensorsModule from "@/lib/api/agent/sensors";

vi.mock("@/components/command/settings/use-node-direct-agent", () => ({
  useNodeDirectAgent: () => ({ agentUrl: "http://192.168.1.50:8080", apiKey: null, client: null }),
}));
// The poll stays inert: the store is seeded by each test.
vi.mock("@/lib/api/agent/sensors", async (orig) => ({
  ...(await orig<typeof SensorsModule>()),
  nodeSensorsApiFromAgent: () => null,
}));

function renderTab(nodeDeviceId: string | null = DEMO_VISOR.deviceId) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SensorsTab nodeDeviceId={nodeDeviceId} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => useNodeSensorsStore.getState().clear());
afterEach(cleanup);

describe("rateLevel", () => {
  it("is amber below 90 % of expected and red below 50 %", () => {
    expect(rateLevel(20, 20)).toBe("ok");
    expect(rateLevel(18, 20)).toBe("ok");
    expect(rateLevel(17.9, 20)).toBe("warn");
    expect(rateLevel(9.9, 20)).toBe("bad");
    expect(rateLevel(0, 0)).toBe("idle");
    expect(rateLevel(3, 0)).toBe("ok");
  });

  it("draws no verdict when the expected rate is unknown", () => {
    expect(rateLevel(50, null)).toBe("none");
    expect(rateLevel(0, null)).toBe("none");
  });

  it("reads a negative sigma as unmeasured", () => {
    expect(sigmaMs(-1)).toBeNull();
    expect(sigmaMs(400_000)).toBe("0.40");
  });
});

describe("Visor SensorsTab", () => {
  it("renders one row per rig sensor with its rate drawn by level", () => {
    seedVisorReadings(0);
    renderTab();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(DEMO_VISOR_SENSORS.sensors.length);
    const gnss = rows.find((r) => within(r).queryByText("gnss0"));
    expect(gnss).toBeDefined();
    // Indoors the receiver has no fix: neutral, never a red failing rate.
    expect(within(gnss!).getByText("no fix").className).toContain("text-text-tertiary");
    const imu = rows.find((r) => within(r).queryByText("imu0"));
    expect(within(imu!).getByText(/^1000/).className).toContain("text-status-success");
    expect(screen.getByText("ados-sensorhub 0.1.0")).toBeTruthy();
    expect(screen.getByText("clock σ 0.40 ms")).toBeTruthy();
    // Unknown expected rate: the plain rate, no "(expected)" and no colour verdict.
    const mag = rows.find((r) => within(r).queryByText("mag0"));
    const magRate = within(mag!).getByText(/^50\.0/);
    expect(magRate.textContent).toBe("50.0");
    expect(magRate.className).toContain("text-text-secondary");
    expect(magRate.className).not.toMatch(/text-status-/);
  });

  it("says the service is not fitted on present:false, never an empty table", () => {
    useNodeSensorsStore.getState().setReadings(DEMO_VISOR.deviceId, {
      sensors: { present: false, rig_id: null, calib_version: null, hub: null, fc: null, sensors: [], gnss: null },
      clock: null,
      storage: null,
      battery: null,
      sessions: undefined,
    });
    renderTab();
    expect(screen.getByText("No sensor service on this node")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("does not show another node's readings", () => {
    seedVisorReadings(0);
    renderTab("visor-2");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Reading the rig sensors…")).toBeTruthy();
  });
});
