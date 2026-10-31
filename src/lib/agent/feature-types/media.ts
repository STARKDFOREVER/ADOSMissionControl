/**
 * @module FeatureTypes
 * @description Agent camera, video, compute, vision and display capability types.
 * @license GPL-3.0-only
 */

// ── Agent Capabilities (from /api/status/full) ───────────

export interface CameraCapability {
  name: string;
  type: "csi" | "usb" | "ip";
  device?: string;
  resolution: string;
  fps?: number;
  /** Whether the agent reports the camera as being encoded and published;
   * `null` when the agent does not report it. */
  streaming: boolean | null;
}

/** One addressable video LEG a node serves (a smart pod / dual-camera rig),
 * distinct from the {@link CameraCapability} probe roster: it has a stable
 * mediamtx-path id and a resolved WHEP URL the GCS stream switcher can connect
 * to directly. Populated (host-resolved) by the status/heartbeat producers. */
export interface VideoStreamLeg {
  /** Stable per-drone stream id (the mediamtx path + WHEP id). */
  id: string;
  /** Logical sensor role: eo / eo_wide / ir / split — drives the tab label. */
  role?: string;
  codec?: string;
  /** Fully-resolved WHEP URL against the node's reachable host. */
  whepUrl: string;
  /** Agent-sampled per-leg liveness: `false` = a known-dead leg (its source is
   * not producing), rendered disabled and never auto-selected; `true` = live;
   * absent/`null` = not-yet-sampled or an idle on-demand secondary with no
   * reader — treated as selectable, never dead. */
  live?: boolean | null;
}

export interface ComputeCapability {
  npu_available: boolean;
  npu_runtime: "rknn" | "tensorrt" | "tflite" | "opencv_dnn" | null;
  npu_tops: number;
  /** Null when the agent does not report NPU load. */
  npu_utilization_pct: number | null;
  gpu_available: boolean;
}

export interface VisionState {
  engine_state: "off" | "initializing" | "ready" | "active" | "degraded" | "error";
  active_behavior: string | null;
  behavior_state: "idle" | "designating" | "searching" | "tracking" | "executing" | "paused" | null;
  fps: number;
  inference_ms: number;
  model_loaded: string | null;
  track_count: number;
  target_locked: boolean;
  target_confidence: number;
  obstacle_mode: "off" | "brake" | "detour";
  nearest_obstacle_m: number | null;
  threat_level: "green" | "yellow" | "red";
  error_message?: string;
}

export interface InstalledModel {
  id: string;
  variant: string;
  format: string;
  size_mb: number;
  loaded: boolean;
}

/**
 * Compact live-detection summary the agent forwards every heartbeat
 * when the vision engine is running a detection model. Distinct from
 * the richer `VisionState` block: this is the at-a-glance throughput
 * the drone-detail Vision tab shows without subscribing to a frame or
 * detection stream. All fields optional so an agent that predates the
 * vision surface leaves the whole block undefined.
 */
export interface VisionSummary {
  /** Active model id the engine has loaded, or null when idle. */
  activeModel?: string | null;
  /** Inference backend in use: "ort" | "rknn" | "mock". Free-form so a
   * future agent can advertise another backend without a GCS release. */
  backend?: string | null;
  /** Rolling detections-per-second the engine is publishing. */
  detectionsPerSec?: number;
  /** Vision pipeline frames-per-second (post-inference). */
  fps?: number;
}

export interface ModelCacheInfo {
  installed: InstalledModel[];
  cache_used_mb: number;
  /** Null when the agent does not report a cache ceiling. */
  cache_max_mb: number | null;
  registry_url: string;
}

/**
 * Local panel attached to the companion board over the 40-pin
 * expansion header (e.g. a 3.5" SPI LCD on a Cubie A7Z or Rock 5C
 * ground station). The agent reports this as a peripheral with
 * category="display"; infer-capabilities maps it to this shape so
 * the Hardware tab can render a status card and the drone card can
 * show an "LCD" pill next to the role badge.
 *
 * The live-state fields (touchCalibrated, activePage, lastTouchAt,
 * lastGesture, snapshotUrl) are populated from top-level heartbeat
 * keys, not from the peripheral's extra blob, so they refresh every
 * heartbeat without depending on a peripheral re-enumeration.
 */
export type LcdGesture = "tap" | "long_press" | "swipe" | "drag";

export interface AttachedDisplay {
  type: "spi-lcd" | "hdmi" | "none";
  controller?: string;
  hasTouch?: boolean;
  resolution?: string;
  rotation?: number;
  /** True once the touch panel has been calibrated against the
   * current rotation. Reflected in the agent's persistent display
   * config. Undefined for legacy heartbeats. */
  touchCalibrated?: boolean;
  /** Currently rendered page on the local LCD. Free-form string so
   * a future agent can add new pages without a GCS-side enum bump.
   * Examples: "dashboard" | "video" | "settings" | "more" |
   * "details.radio_link". */
  activePage?: string;
  /** Epoch milliseconds of the most recent touch event the agent
   * processed. Used by the Display sub-view to surface "last touch
   * Xs ago" without polling a separate endpoint. */
  lastTouchAt?: number;
  /** Most recent gesture the agent's touch input bridge classified.
   * "tap" / "long_press" / "swipe" / "drag" matches the agent
   * gesture taxonomy; anything else falls through as undefined. */
  lastGesture?: LcdGesture;
  /** Absolute URL to the agent's display snapshot endpoint. Returns
   * a PNG of the current framebuffer when polled. Lets the GCS show
   * a thumbnail without holding a video stream open. */
  snapshotUrl?: string;
}

/**
 * Snapshot of the agent's local-display video appsink tap. When the
 * companion board is rendering video to a bound LCD, the agent's
 * GStreamer pipeline forks a low-FPS appsink whose state we surface
 * here so the GCS can show "decoding via mppvideodec at 30 fps" in
 * the Hardware tab and the Video sub-view.
 */
export interface VideoLocalTap {
  /** True when the local appsink is producing frames. False when
   * the pipeline has paused the local tap (e.g. video recording is
   * the only active sink, or the LCD is off). Undefined for legacy
   * heartbeats that predate the local tap. */
  active?: boolean;
  /** Hardware decoder element name in the agent's pipeline.
   * Examples: "mppvideodec" (Rockchip), "v4l2h264dec" (Pi),
   * "avdec_h264" (software fallback). */
  decoderType?: string;
  /** Frames per second the local appsink is emitting. Used as the
   * refresh metric in the Hardware tab. */
  fps?: number;
}
