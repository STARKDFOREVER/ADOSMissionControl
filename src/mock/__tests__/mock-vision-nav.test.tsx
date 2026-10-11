/**
 * @module mock-vision-nav.test
 * @description The demo Vision Nav tab: the health snapshot carries the
 * vision-nav 0.5.0 `navigation` block key for key with a pre-arm report the
 * gate would produce from the same readings, the tab body is keyed to the
 * install row its header reads, and the inline module renders the panel's
 * cards, Pre-arm included.
 * @license GPL-3.0-only
 */

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { InlineHostApi } from "@/lib/plugins/inline-host-types";
import { slotToCapability } from "@/lib/plugins/types";
import { getDemoDronePluginContributions } from "@/mock/mock-plugins";
import {
  DEMO_VISION_NAV_MODULE,
  getDemoVisionNavContribution,
  getMockVisionNavHealth,
  VISION_NAV_HEALTH_KEYS,
  VISION_NAV_PANEL_ID,
  VISION_NAV_PLUGIN_ID,
} from "@/mock/mock-vision-nav";

describe("getMockVisionNavHealth", () => {
  it("emits exactly the 0.5.0 navigation block keys, in agent order", () => {
    expect(Object.keys(getMockVisionNavHealth())).toEqual([...VISION_NAV_HEALTH_KEYS]);
  });

  it("advertises the estimators 0.5.0 runs and a converged optical-flow run", () => {
    const h = getMockVisionNavHealth();
    expect(h.opticalFlowSupported).toBe(true);
    expect(h.availableEstimators).toEqual(["off", "optical_flow", "optical_flow_degraded"]);
    expect(h).toMatchObject({
      mode: "optical_flow",
      companionState: "active",
      estimatorState: "converged",
      rangefinderTopology: "companion",
      flowScaleSource: "rangefinder",
      imuSource: "mavlink-raw-imu",
      cameraIntrinsicsLoaded: true,
      emitErrors: 0,
      rangefinderError: null,
      degradedReasons: [],
      fcParams: [],
    });
  });

  it("reports the gate's checks, computed from the same readings", () => {
    const h = getMockVisionNavHealth();
    const report = h.preArmReport!;
    expect(report.mode).toBe(h.mode);
    expect(report.checks.map((c) => c.id)).toEqual(["companion_active", "flow_quality", "rangefinder"]);
    expect(h.flowQuality!).toBeGreaterThanOrEqual(50);
    expect(report.checks[1].detail).toBe(`Quality ${h.flowQuality}/255.`);
    expect(report.checks[2].detail).toBe(`Topology: companion, ${h.flowDistanceM!.toFixed(2)} m`);
    expect(report.armable).toBe(report.checks.every((c) => c.severity === "ok"));
    expect(report.armable).toBe(true);
  });
});

describe("getDemoVisionNavContribution", () => {
  it("mounts under the tab header the demo drone's install row produces", () => {
    const header = getDemoDronePluginContributions("alpha-1").find(
      (c) => c.pluginId === VISION_NAV_PLUGIN_ID,
    )!;
    const demo = getDemoVisionNavContribution("alpha-1")!;
    expect(header.version).toBe("0.5.0");
    expect(demo.contribution.pluginInstallId).toBe(header.installId);
    expect(demo.contribution.panelId).toBe(header.panelId);
    expect(demo.contribution.panelId).toBe(VISION_NAV_PANEL_ID);
    expect(demo.contribution.isolation).toBe("inline");
    expect(demo.contribution.grantedCapabilities.has(slotToCapability("node.detail.tab"))).toBe(
      true,
    );
    expect(demo.entry.profile).toEqual(["drone"]);
    // Identity-stable, so a re-render does not remount the panel.
    expect(getDemoVisionNavContribution("alpha-1")).toBe(demo);
  });

  it("is absent on a demo drone without the extension", () => {
    expect(getDemoVisionNavContribution("charlie-3")).toBeNull();
  });
});

describe("DEMO_VISION_NAV_MODULE", () => {
  let root: HTMLElement | null = null;
  afterEach(() => {
    root?.remove();
    root = null;
  });

  it("renders the panel cards, Pre-arm included", async () => {
    root = document.createElement("div");
    document.body.append(root);
    const host = {
      ctx: {
        theme: { onChange: () => () => {} },
        i18n: { t: (key: string) => key },
      },
    } as unknown as InlineHostApi;
    let dispose: (() => void) | null = null;
    await act(async () => {
      dispose = await DEMO_VISION_NAV_MODULE.mount(root!, host);
    });
    const text = root.textContent ?? "";
    for (const label of [
      "Vision Nav",
      "Companion: Active",
      "Mode",
      "Sensors",
      "Estimator",
      "Flow health",
      "Pre-arm",
      "Ready",
      "Companion process active",
      "Rangefinder healthy",
      "Lucas-Kanade",
    ]) {
      expect(text).toContain(label);
    }
    await act(async () => {
      dispose?.();
      await Promise.resolve();
    });
    expect(root.textContent).toBe("");
  });
});
