/**
 * @module CustomCameraEditor
 * @description Inline editor for an operator-defined camera profile: name,
 * sensor and image size, focal length and the camera's fastest trigger
 * interval. Save validates the profile (every dimension and the focal length
 * above 0, a name no other camera uses) before handing it back.
 * @license GPL-3.0-only
 */
"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { PropertyRow } from "@/components/ui/property-row";
import { PatternNumberRow } from "./PatternNumberRow";
import {
  CAMERA_PROFILES, validateCameraProfile, type CameraProfile, type CameraProfileProblem,
} from "@/lib/patterns/gsd-calculator";
import { cn } from "@/lib/utils";

interface CustomCameraEditorProps {
  /** The camera being edited, or undefined for a new one. */
  initial?: CameraProfile;
  /** Names already taken (built-in and other custom cameras). */
  takenNames: readonly string[];
  onSave: (camera: CameraProfile) => void;
  onCancel: () => void;
}

const PROBLEM_KEYS = {
  name: "errorName",
  sensor: "errorSensor",
  image: "errorImage",
  focal: "errorFocal",
  interval: "errorInterval",
} as const satisfies Record<CameraProfileProblem, string>;

const buttonClass =
  "flex h-7 flex-1 items-center justify-center rounded-sm border border-border-default px-2 text-xs transition-colors cursor-pointer focus-ring hover:bg-bg-tertiary";

export function CustomCameraEditor({ initial, takenNames, onSave, onCancel }: CustomCameraEditorProps) {
  const t = useTranslations("planner.pattern.customCamera");
  const nameId = useId();
  const [draft, setDraft] = useState<CameraProfile>(
    initial ?? { name: "", sensorWidth: 0, sensorHeight: 0, imageWidth: 0, imageHeight: 0, focalLength: 0 },
  );
  const [problems, setProblems] = useState<CameraProfileProblem[]>([]);
  const set = (update: Partial<CameraProfile>) => setDraft((d) => ({ ...d, ...update }));

  const save = () => {
    const camera = { ...draft, name: draft.name.trim() };
    const found = validateCameraProfile(camera);
    const nameTaken = takenNames.includes(camera.name) && camera.name !== initial?.name;
    if (nameTaken && !found.includes("name")) found.unshift("name");
    // A built-in name is never free, even when editing.
    if (CAMERA_PROFILES.some((c) => c.name === camera.name) && !found.includes("name")) found.unshift("name");
    setProblems(found);
    if (found.length === 0) onSave(camera);
  };

  return (
    <div className="my-1 flex flex-col rounded-sm border border-border-default p-2" role="group" aria-label={t("title")}>
      <span className="pb-1 text-[11px] font-semibold text-text-tertiary">{t("title")}</span>
      <PropertyRow label={t("name")}>
        <input id={nameId} type="text" value={draft.name} aria-label={t("name")}
          onChange={(e) => set({ name: e.target.value })}
          className="h-7 w-full border border-border-default bg-bg-tertiary px-2 text-xs text-text-primary focus:border-accent-primary focus:outline-none focus-ring" />
      </PropertyRow>
      <PatternNumberRow label={t("sensorWidth")} unit="mm" step={0.01} min={0} precision={2}
        value={draft.sensorWidth || undefined} onCommit={(sensorWidth) => set({ sensorWidth })} />
      <PatternNumberRow label={t("sensorHeight")} unit="mm" step={0.01} min={0} precision={2}
        value={draft.sensorHeight || undefined} onCommit={(sensorHeight) => set({ sensorHeight })} />
      <PatternNumberRow label={t("imageWidth")} unit="px" step={1} min={0} precision={0}
        value={draft.imageWidth || undefined} onCommit={(imageWidth) => set({ imageWidth })} />
      <PatternNumberRow label={t("imageHeight")} unit="px" step={1} min={0} precision={0}
        value={draft.imageHeight || undefined} onCommit={(imageHeight) => set({ imageHeight })} />
      <PatternNumberRow label={t("focalLength")} unit="mm" step={0.01} min={0} precision={2}
        value={draft.focalLength || undefined} onCommit={(focalLength) => set({ focalLength })} />
      <PatternNumberRow label={t("minInterval")} unit="s" step={0.1} min={0} precision={1} placeholder="—"
        value={draft.minTriggerIntervalS} onCommit={(minTriggerIntervalS) => set({ minTriggerIntervalS })}
        onClear={() => set({ minTriggerIntervalS: undefined })} />
      {problems.length > 0 && (
        <ul className="py-1 text-[11px] text-status-error" role="alert">
          {problems.map((p) => <li key={p}>{t(PROBLEM_KEYS[p])}</li>)}
        </ul>
      )}
      <div className="flex gap-1.5 pt-1">
        <button type="button" onClick={save} className={cn(buttonClass, "font-semibold text-text-primary")}>
          {t("save")}
        </button>
        <button type="button" onClick={onCancel} className={cn(buttonClass, "text-text-secondary")}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
