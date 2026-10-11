/**
 * @module mock/mock-vision-nav
 * @description Demo stand-in for the Vision Navigation extension's node tab
 * (`com.altnautica.vision-nav` 0.5.0, panel `vision-nav-tab`). The extension
 * ships its panel as a signed iframe bundle that demo mode cannot load, so the
 * demo mounts an in-memory inline module through the same plugin slot host
 * (`PluginSlot` → `InlinePluginHost`) on the demo drone that has the extension
 * installed. The module renders the panel's cards against
 * {@link getMockVisionNavHealth}, refreshed at the heartbeat cadence.
 *
 * The health payload mirrors the extension's `navigation` telemetry block
 * key for key (`HealthSnapshot::to_value` in the extension's agent half):
 * every key is always present, an unset optional rides as `null`, and the
 * pre-arm report is the gate's `{ mode, armable, checks }` map.
 *
 * @license GPL-3.0-only
 */

import type { InlinePluginModule } from "@/lib/plugins/inline-host-types";
import type { PluginSlotContribution } from "@/components/plugins/PluginHostProvider";
import { slotToCapability, type GcsContributeRow } from "@/lib/plugins/types";
import { getDemoDronePluginInstalls } from "./mock-plugins";
import { jitter } from "./agent/utils";

export const VISION_NAV_PLUGIN_ID = "com.altnautica.vision-nav";
export const VISION_NAV_PANEL_ID = "vision-nav-tab";
export const VISION_NAV_VERSION = "0.5.0";

/** Heartbeat cadence the panel refreshes its health snapshot at. */
export const VISION_NAV_REFRESH_MS = 1000;

export type VisionNavMode = "off" | "optical_flow" | "optical_flow_degraded";
export type VisionNavCheckSeverity = "ok" | "pending" | "blocking";

export interface VisionNavPreArmCheck {
  id: string;
  severity: VisionNavCheckSeverity;
  detail: string;
}

export interface VisionNavPreArmReport {
  mode: VisionNavMode;
  armable: boolean;
  checks: VisionNavPreArmCheck[];
}

/** The extension's `navigation` block, in the order its agent emits the keys. */
export interface VisionNavHealth {
  opticalFlowSupported: boolean;
  rangefinderTopology: "companion" | "fc" | "both" | null;
  recommendedCameraId: string | null;
  flowQuality: number | null;
  flowRateHz: number | null;
  flowDistanceM: number | null;
  companionState: "active" | "critical" | "terminating" | "inactive";
  mode: VisionNavMode | null;
  availableEstimators: string[];
  estimatorState: "off" | "init" | "converging" | "converged" | "degraded" | "failed";
  flowScaleSource: "rangefinder" | "baro" | "gps" | "vision" | "static" | null;
  imuSource: string | null;
  imuRateHz: number | null;
  cameraImuSyncOffsetMs: number | null;
  cameraIntrinsicsLoaded: boolean;
  preArmReport: VisionNavPreArmReport | null;
  emitErrors: number;
  rangefinderError: string | null;
  degradedReasons: string[];
  fcParams: string[];
}

/** The 0.5.0 `navigation` block keys, in emit order. */
export const VISION_NAV_HEALTH_KEYS = [
  "opticalFlowSupported",
  "rangefinderTopology",
  "recommendedCameraId",
  "flowQuality",
  "flowRateHz",
  "flowDistanceM",
  "companionState",
  "mode",
  "availableEstimators",
  "estimatorState",
  "flowScaleSource",
  "imuSource",
  "imuRateHz",
  "cameraImuSyncOffsetMs",
  "cameraIntrinsicsLoaded",
  "preArmReport",
  "emitErrors",
  "rangefinderError",
  "degradedReasons",
  "fcParams",
] as const satisfies ReadonlyArray<keyof VisionNavHealth>;

/** The estimators 0.5.0 can run, sorted as its agent sorts them. */
const AVAILABLE_ESTIMATORS = ["off", "optical_flow", "optical_flow_degraded"];

/**
 * Steady-state health of a converged optical-flow run with a companion
 * rangefinder: flow quality well above the 50/255 gate, a fresh in-range
 * reading, the camera calibrated, RAW_IMU feeding the aligner. The pre-arm
 * checks and their detail strings are the gate's own, computed from the same
 * values so the card and the readings never disagree. Values jitter per call
 * so the live panel moves.
 */
export function getMockVisionNavHealth(): VisionNavHealth {
  const flowQuality = Math.round(jitter(186, 10));
  const distanceM = Math.round(jitter(1.25, 0.04) * 100) / 100;
  return {
    opticalFlowSupported: true,
    rangefinderTopology: "companion",
    recommendedCameraId: "/dev/video0",
    flowQuality,
    flowRateHz: Math.round(jitter(29.6, 0.3) * 10) / 10,
    flowDistanceM: distanceM,
    companionState: "active",
    mode: "optical_flow",
    availableEstimators: [...AVAILABLE_ESTIMATORS],
    estimatorState: "converged",
    flowScaleSource: "rangefinder",
    imuSource: "mavlink-raw-imu",
    imuRateHz: Math.round(jitter(100, 2) * 10) / 10,
    cameraImuSyncOffsetMs: Math.round(jitter(4.2, 0.8) * 10) / 10,
    cameraIntrinsicsLoaded: true,
    preArmReport: {
      mode: "optical_flow",
      armable: true,
      checks: [
        { id: "companion_active", severity: "ok", detail: "" },
        { id: "flow_quality", severity: "ok", detail: `Quality ${flowQuality}/255.` },
        {
          id: "rangefinder",
          severity: "ok",
          detail: `Topology: companion, ${distanceM.toFixed(2)} m`,
        },
      ],
    },
    emitErrors: 0,
    rangefinderError: null,
    degradedReasons: [],
    fcParams: [],
  };
}

/** The inline module the demo mounts in place of the extension's bundle. The
 * React panel is imported on mount, not at module load: the plugin
 * contribution producer imports this file on every route, and the panel only
 * belongs in the chunk a demo session opens. */
export const DEMO_VISION_NAV_MODULE: InlinePluginModule = {
  async mount(root, host) {
    const { mountVisionNavDemoPanel } = await import("./vision-nav-demo-panel");
    return mountVisionNavDemoPanel(root, host);
  },
};

/** Capabilities the extension's GCS half requests in its 0.5.0 manifest. */
const VISION_NAV_GCS_CAPABILITIES = [
  slotToCapability("node.detail.tab"),
  "ui.slot.flight-skill",
  "telemetry.subscribe.navigation",
];

interface DemoVisionNavContribution {
  entry: GcsContributeRow;
  contribution: PluginSlotContribution & { slot: "node.detail.tab" };
}

/** One contribution per drone, so a re-render hands the host the same bundle
 * object and the mounted panel is not torn down and rebuilt. */
const contributionCache = new Map<string, DemoVisionNavContribution | null>();

/**
 * The demo Vision Nav tab body for a drone, or null when that demo drone does
 * not run the extension. Keyed by the same install row the tab header reads,
 * so the body mounts under the header the operator clicked.
 */
export function getDemoVisionNavContribution(deviceId: string): DemoVisionNavContribution | null {
  const cached = contributionCache.get(deviceId);
  if (cached !== undefined) return cached;
  const built = buildContribution(deviceId);
  contributionCache.set(deviceId, built);
  return built;
}

function buildContribution(deviceId: string): DemoVisionNavContribution | null {
  const install = getDemoDronePluginInstalls(deviceId).find(
    (p) => p.pluginId === VISION_NAV_PLUGIN_ID && p.status === "running",
  );
  if (!install) return null;
  const title = install.droneDetailTabTitle ?? install.name;
  return {
    entry: {
      slot: "node.detail.tab",
      panelId: VISION_NAV_PANEL_ID,
      title,
      profile: ["drone"],
    },
    contribution: {
      slot: "node.detail.tab",
      pluginId: VISION_NAV_PLUGIN_ID,
      panelId: VISION_NAV_PANEL_ID,
      title,
      bundleUrl: "",
      isolation: "inline",
      inline: {
        status: "ready",
        bundle: {
          kind: "inline",
          module: DEMO_VISION_NAV_MODULE,
          trust: {
            pluginId: VISION_NAV_PLUGIN_ID,
            version: install.version,
            signerId: "demo",
            entrypoint: "gcs/plugin.bundle.js",
            paths: [],
          },
          readAsset: () => Promise.reject(new Error("the demo panel ships no assets")),
        },
      },
      grantedCapabilities: new Set(VISION_NAV_GCS_CAPABILITIES),
      handlers: {},
      pluginInstallId: install.installId,
    },
  };
}
