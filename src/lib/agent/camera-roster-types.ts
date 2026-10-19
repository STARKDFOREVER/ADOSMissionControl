/**
 * @module agent/camera-roster-types
 * @description Types of the camera roster (`GET`/`PUT /api/video/roster`) and
 * the keys a top-level `cameras[]` config entry carries.
 * @license GPL-3.0-only
 */

/** Coarse physical mount of a camera on the airframe. A leg declares one so the
 * roster can badge it and a plugin can bind "the down-facing camera" by
 * orientation rather than a device path. */
export const CAMERA_ORIENTATIONS = [
  "forward",
  "down",
  "back",
  "left",
  "right",
  "up",
  "gimbal",
  "custom",
] as const;

/** What a camera leg is used for. A leg carries zero or more purposes; a plugin
 * binds a camera by required purpose (e.g. `detect`, `precision-landing`). */
export const CAMERA_PURPOSES = [
  "feed",
  "detect",
  "navigation",
  "precision-landing",
  "thermal",
  "mapping",
  "recording",
] as const;

/** Where a camera roster row sits: assigned to a stream, an unassigned
 * discovered device, owned by a plugin (read-only to the operator), or a
 * declared device that is currently absent. */
export type RosterCameraState =
  | "assigned"
  | "discovered_unassigned"
  | "plugin_owned"
  | "offline";

/** A physical-device fingerprint that re-pins a leg's logical id across a
 * hot-plug or reboot (a USB `vid:pid[:serial]`, or a CSI sensor + port). */
export interface CameraFingerprint {
  usb?: string;
  csi_sensor?: string;
  csi_port?: number;
}

/** One row of the camera roster the agent's `GET /api/video/roster` returns:
 * a declared leg, a discovered device, or the reconciliation of both, with the
 * management metadata (name / orientation / purpose / owner / mount) plus a
 * `state` telling the operator what it is. Nullable fields are `null` when the
 * agent has no value, never fabricated. */
export interface RosterCamera {
  /** Immutable logical key for the leg (stable across hot-plug). */
  id: string;
  name?: string | null;
  /** Device path, capture URL, or a bare device-class hint. */
  source: string;
  /** Transport role (`primary` → the `main` stream; `ir` / `eo_wide` / …). */
  role?: string | null;
  /** Consumer purposes; always present (empty for an unassigned device). */
  purpose: string[];
  orientation?: string | null;
  enabled: boolean;
  /** `operator` (or absent) for an operator-managed leg; a plugin id when a
   * plugin owns it (the row renders read-only). */
  owner?: string | null;
  state: RosterCameraState;
  /** Agent-sampled liveness: `true` live, `false` known-dead, `null` unsampled. */
  live?: boolean | null;
  device_path?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  codec?: string | null;
  /** Transmit bitrate in kbps for this leg's encoder. The agent leg schema
   * carries a real value (not an option), so the roster GET reports it and the
   * operator write must round-trip it or the agent resets it to the compiled
   * default. */
  bitrate_kbps?: number | null;
  /** Opaque per-leg calibration payload the agent round-trips verbatim (camera
   * intrinsics / distortion blob). Carried through untouched. */
  calibration?: string | null;
  match?: CameraFingerprint | null;
  fov_deg?: number | null;
  mount_pitch_deg?: number | null;
  /** Capture + encode-plane keys of the `cameras[]` entry, carried so an
   * operator write never drops them. Null / absent when the agent did not
   * report the key. */
  capture?: boolean | null;
  format?: CameraCaptureFormat | null;
  exposure_us?: number | null;
  gain?: number | null;
  trigger?: CameraTrigger | null;
  trigger_channel?: number | null;
  keyframe_interval?: number | null;
  rotation?: number | null;
  hflip?: boolean | null;
  vflip?: boolean | null;
  encoder?: string | null;
}

/** Pixel formats a captured camera (`capture: true`) may be delivered in. */
export const CAMERA_CAPTURE_FORMATS = [
  "gray8",
  "gray16",
  "rgb24",
  "nv12",
  "yuv420p",
  "bayer_rggb8",
  "bayer_rggb16",
] as const;
export type CameraCaptureFormat = (typeof CAMERA_CAPTURE_FORMATS)[number];

/** Where a captured camera's exposure trigger records come from. */
export const CAMERA_TRIGGERS = ["none", "hub", "fc"] as const;
export type CameraTrigger = (typeof CAMERA_TRIGGERS)[number];

/** The largest `keyframe_interval` (frames) a `cameras[]` entry may declare. */
export const MAX_KEYFRAME_INTERVAL = 30;

/** One leg in the `PUT /api/video/roster` body. The operator write is a full
 * declared-leg list; the agent stamps the owner and merges by owner so plugin
 * legs are preserved, and merges each leg onto its stored entry of the same
 * id (a key left out is kept, `null` clears it). Only `id` + `source` are
 * required. */
export interface CameraLegInput {
  id: string;
  source: string;
  role?: string | null;
  orientation?: string | null;
  purpose?: string[];
  enabled?: boolean;
  name?: string | null;
  codec?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  bitrate_kbps?: number | null;
  /** Opaque per-leg calibration payload preserved across a write so the agent
   * keeps the leg's calibration instead of dropping it. */
  calibration?: string | null;
  fov_deg?: number | null;
  mount_pitch_deg?: number | null;
  match?: CameraFingerprint | null;
  capture?: boolean | null;
  format?: CameraCaptureFormat | null;
  /** Manual exposure (µs, ≥ 1); `null` hands exposure back to auto. */
  exposure_us?: number | null;
  gain?: number | null;
  trigger?: CameraTrigger | null;
  trigger_channel?: number;
  keyframe_interval?: number | null;
  rotation?: number;
  hflip?: boolean;
  vflip?: boolean;
  encoder?: string;
}
