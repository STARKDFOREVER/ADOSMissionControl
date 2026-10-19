"use client";

/**
 * @module drone-detail/cameras/CameraCaptureFields
 * @description The capture keys of one `cameras[]` entry inside the camera
 * editor: whether the vision engine captures the camera, its pixel format,
 * manual exposure and gain, the trigger source, and the encoder keyframe
 * interval. Holds the text of each field as a draft; {@link captureDraftPatch}
 * turns the draft into the changed keys, or the first validation error.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Toggle } from "@/components/ui/toggle";
import { Select, type SelectOption } from "@/components/ui/select";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import {
  CAMERA_CAPTURE_FORMATS,
  CAMERA_TRIGGERS,
  MAX_KEYFRAME_INTERVAL,
  type CameraCaptureFormat,
  type CameraTrigger,
  type RosterCamera,
} from "@/lib/agent/camera-roster-types";
import type { CameraPatch } from "@/lib/agent/camera-roster";

const INPUT_CLASS =
  "w-full rounded-md border border-border-default bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none";

/** The editable text of each capture field ("" = the agent default). */
export interface CaptureDraft {
  capture: boolean;
  format: string;
  exposure: string;
  gain: string;
  trigger: string;
  keyframe: string;
}

export type CaptureFieldError = "exposureInvalid" | "gainInvalid" | "keyframeInvalid";

export function captureDraftFrom(camera: RosterCamera): CaptureDraft {
  const text = (v: number | null | undefined) => (v != null ? String(v) : "");
  return {
    capture: camera.capture === true,
    format: camera.format ?? "",
    exposure: text(camera.exposure_us),
    gain: text(camera.gain),
    trigger: camera.trigger ?? "",
    keyframe: text(camera.keyframe_interval),
  };
}

/** A number field: null when empty, NaN when not a finite number. */
function parseField(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** The capture keys the draft changes against the camera, or the first field
 * that does not validate (the agent refuses exposure 0 and a keyframe interval
 * above 30, so the editor refuses them first). */
export function captureDraftPatch(
  camera: RosterCamera,
  draft: CaptureDraft,
): { patch: CameraPatch } | { error: CaptureFieldError } {
  const exposure = parseField(draft.exposure);
  if (exposure !== null && !(Number.isInteger(exposure) && exposure >= 1)) {
    return { error: "exposureInvalid" };
  }
  const gain = parseField(draft.gain);
  if (gain !== null && Number.isNaN(gain)) return { error: "gainInvalid" };
  const keyframe = parseField(draft.keyframe);
  if (
    keyframe !== null &&
    !(Number.isInteger(keyframe) && keyframe >= 0 && keyframe <= MAX_KEYFRAME_INTERVAL)
  ) {
    return { error: "keyframeInvalid" };
  }
  const patch: CameraPatch = {};
  if (draft.capture !== (camera.capture === true)) patch.capture = draft.capture;
  const format = draft.format === "" ? null : (draft.format as CameraCaptureFormat);
  if (format !== (camera.format ?? null)) patch.format = format;
  if (exposure !== (camera.exposure_us ?? null)) patch.exposure_us = exposure;
  if (gain !== (camera.gain ?? null)) patch.gain = gain;
  const trigger = draft.trigger === "" ? null : (draft.trigger as CameraTrigger);
  if (trigger !== (camera.trigger ?? null)) patch.trigger = trigger;
  if (keyframe !== (camera.keyframe_interval ?? null)) patch.keyframe_interval = keyframe;
  return { patch };
}

export function CameraCaptureFields({
  draft,
  error,
  onChange,
}: {
  draft: CaptureDraft;
  error: CaptureFieldError | null;
  onChange: (draft: CaptureDraft) => void;
}) {
  const t = useTranslations("cameras.editor.capture");
  const set = (patch: Partial<CaptureDraft>) => onChange({ ...draft, ...patch });

  const formatOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: t("formatDefault") },
      ...CAMERA_CAPTURE_FORMATS.map((f) => ({ value: f, label: t(`formats.${f}`) })),
    ],
    [t],
  );
  const triggerOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: t("triggerDefault") },
      ...CAMERA_TRIGGERS.map((v) => ({ value: v, label: t(`triggers.${v}`) })),
    ],
    [t],
  );

  return (
    <CollapsibleSection title={t("title")} defaultOpen={draft.capture}>
      <div className="space-y-3 pt-2">
        <div className="space-y-1">
          <Toggle
            label={t("toggle")}
            checked={draft.capture}
            onChange={(capture) => set({ capture })}
          />
          <p className="text-[11px] text-text-tertiary">{t("hint")}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-xs text-text-secondary">{t("format")}</span>
            <Select
              options={formatOptions}
              value={draft.format}
              onChange={(format) => set({ format })}
              ariaLabel={t("format")}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-text-secondary">{t("trigger")}</span>
            <Select
              options={triggerOptions}
              value={draft.trigger}
              onChange={(trigger) => set({ trigger })}
              ariaLabel={t("trigger")}
            />
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-text-secondary">{t("exposure")}</span>
            <input
              type="number"
              min={1}
              step={1}
              value={draft.exposure}
              onChange={(e) => set({ exposure: e.target.value })}
              placeholder={t("auto")}
              className={INPUT_CLASS}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-text-secondary">{t("gain")}</span>
            <input
              type="number"
              step="any"
              value={draft.gain}
              onChange={(e) => set({ gain: e.target.value })}
              placeholder={t("auto")}
              className={INPUT_CLASS}
            />
          </label>
          <label className="col-span-2 block space-y-1">
            <span className="text-xs text-text-secondary">{t("keyframe")}</span>
            <input
              type="number"
              min={0}
              max={MAX_KEYFRAME_INTERVAL}
              step={1}
              value={draft.keyframe}
              onChange={(e) => set({ keyframe: e.target.value })}
              placeholder={t("auto")}
              className={INPUT_CLASS}
            />
          </label>
        </div>
        <p className="text-[11px] text-text-tertiary">{t("autoHint")}</p>
        {error ? (
          <p role="alert" className="text-[11px] text-status-error">
            {t(error)}
          </p>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}
