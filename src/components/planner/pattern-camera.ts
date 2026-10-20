/**
 * @module pattern-camera
 * @description How a selected camera drives a pattern's spacings. Each camera
 * pattern turns the image footprint (at the flight height, or at the distance
 * from a wall) and the two overlaps into the spacings its generator reads.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { computeFootprint, findCamera, type CameraOrientation, type CameraProfile } from "@/lib/patterns/gsd-calculator";
import { MIN_LINE_SPACING_M, type PatternCameraSettings } from "@/lib/patterns/types";

/** Which pattern the spacings are for. */
export type CameraSpacingKind = "survey" | "corridor" | "structure" | "facade";

export const DEFAULT_SIDELAP_PCT = 60;
export const DEFAULT_FRONTLAP_PCT = 70;

const round = (v: number) => Math.max(MIN_LINE_SPACING_M, Math.round(v * 10) / 10);

/**
 * The config fields a camera sets for a pattern.
 * - Survey and corridor fly over the ground: lines are a footprint width apart
 *   less the side overlap, photos a footprint height apart less the front overlap.
 * - Structure scan flies around a wall: layers are a footprint height apart
 *   less the front overlap, photos a footprint width apart less the side overlap.
 * - Facade flies rows up a wall: rows are a footprint height apart less the
 *   side overlap, photos a footprint width apart less the front overlap.
 */
export function cameraSpacingUpdate(
  kind: CameraSpacingKind,
  camera: CameraProfile,
  rangeM: number,
  sidelapPct: number,
  frontlapPct: number,
  orientation: CameraOrientation = "landscape",
): Record<string, number> {
  const { width, height } = computeFootprint(rangeM, camera, orientation);
  const side = 1 - sidelapPct / 100;
  const front = 1 - frontlapPct / 100;
  switch (kind) {
    case "survey":
    case "corridor":
      return { lineSpacing: round(width * side), cameraTriggerDistance: round(height * front) };
    case "structure":
      return { layerSpacing: round(height * front), cameraTriggerDistance: round(width * side) };
    case "facade":
      return { rowSpacing: round(height * side), cameraTriggerDistance: round(width * front) };
  }
}

/**
 * The selected camera of a pattern config, and an `apply` that writes a
 * config change together with the spacings the camera then implies.
 * `apply` keeps the current overlaps when only the camera changes.
 */
export function usePatternCamera<C extends PatternCameraSettings>(
  config: C,
  kind: CameraSpacingKind,
  rangeM: number,
  update: (update: Partial<C>) => void,
): { camera: CameraProfile | undefined; apply: (partial: Partial<C>, rangeOverrideM?: number) => void } {
  const custom = useSettingsStore((s) => s.customCameras);
  const camera = findCamera(config._cameraName, custom);
  const apply = useCallback(
    (partial: Partial<C>, rangeOverrideM?: number) => {
      const next = { ...config, ...partial };
      const cam = findCamera(next._cameraName, useSettingsStore.getState().customCameras);
      if (!cam) {
        update(partial);
        return;
      }
      const sidelap = next._sidelap ?? DEFAULT_SIDELAP_PCT;
      const frontlap = next._frontlap ?? DEFAULT_FRONTLAP_PCT;
      const spacing = cameraSpacingUpdate(kind, cam, rangeOverrideM ?? rangeM, sidelap, frontlap, next._orientation);
      update({ _sidelap: sidelap, _frontlap: frontlap, ...partial, ...spacing } as Partial<C>);
    },
    [config, kind, rangeM, update],
  );
  return { camera, apply };
}
