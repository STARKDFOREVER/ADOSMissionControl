/**
 * @module PatternAltitudeSection
 * @description Altitude reference for the survey, corridor, structure and
 * facade patterns: above home, follow terrain (the planner samples the ground
 * and writes absolute altitudes) or ArduPilot's terrain frame. The terrain
 * frame is offered only when the plan targets ArduPilot; a pattern left in it
 * when the plan switches to PX4 drops back to above home.
 * @license GPL-3.0-only
 */
"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { PropertyRow } from "@/components/ui/property-row";
import { PropertySection } from "@/components/ui/property-section";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toggle } from "@/components/ui/toggle";
import { usePlanVehicleProfile } from "@/hooks/use-plan-profile";
import {
  DEFAULT_FOLLOW_TERRAIN, type PatternAltitudeMode, type PatternAltitudeSettings,
} from "@/lib/patterns/types";
import { PatternNumberRow } from "./PatternNumberRow";

interface PatternAltitudeSectionProps {
  settings: PatternAltitudeSettings;
  onChange: (update: PatternAltitudeSettings) => void;
}

export function PatternAltitudeSection({ settings, onChange }: PatternAltitudeSectionProps) {
  const t = useTranslations("planner.pattern.altitude");
  const { autopilot } = usePlanVehicleProfile();
  const terrainFrameAvailable = autopilot === "ardupilot";
  const mode: PatternAltitudeMode = settings.altitudeMode ?? "relative";

  useEffect(() => {
    if (!terrainFrameAvailable && mode === "terrain") onChange({ altitudeMode: "relative" });
  }, [terrainFrameAvailable, mode, onChange]);

  const follow = { ...DEFAULT_FOLLOW_TERRAIN, ...settings.followTerrain };
  const setFollow = (update: Partial<typeof follow>) =>
    onChange({ followTerrain: { ...settings.followTerrain, ...update } });

  const options: { value: PatternAltitudeMode; label: string }[] = [
    { value: "relative", label: t("relative") },
    { value: "followTerrain", label: t("followTerrain") },
    ...(terrainFrameAvailable ? [{ value: "terrain" as const, label: t("terrain") }] : []),
  ];

  return (
    <PropertySection title={t("title")} persistKey="pattern.altitude" flush>
      <PropertyRow label={t("reference")}>
        <SegmentedControl<PatternAltitudeMode> size="sm" stretch ariaLabel={t("reference")}
          options={options} value={mode} onChange={(altitudeMode) => onChange({ altitudeMode })} />
      </PropertyRow>
      {mode === "followTerrain" && (
        <>
          <PatternNumberRow label={t("tolerance")} unit="m" step={1} min={1}
            value={follow.toleranceM} onCommit={(toleranceM) => setFollow({ toleranceM })} />
          <PatternNumberRow label={t("maxClimb")} unit="m/s" step={0.1} min={0.1}
            value={follow.maxClimbMps} onCommit={(maxClimbMps) => setFollow({ maxClimbMps })} />
          <PatternNumberRow label={t("maxDescent")} unit="m/s" step={0.1} min={0.1}
            value={follow.maxDescentMps} onCommit={(maxDescentMps) => setFollow({ maxDescentMps })} />
        </>
      )}
      {mode !== "relative" && (
        <p className="py-0.5 text-[11px] text-text-tertiary">
          {mode === "terrain" ? t("terrainHint") : t("followHint")}
        </p>
      )}
    </PropertySection>
  );
}

/**
 * "Hover and capture" toggle; renders nothing unless the plan's vehicle can
 * hover, and switches the option off when the plan moves to one that cannot.
 */
export function HoverCaptureRow({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const t = useTranslations("planner.pattern");
  const { vehicleClass } = usePlanVehicleProfile();
  const canHover = vehicleClass === "copter" || vehicleClass === "vtol";
  useEffect(() => {
    if (!canHover && checked) onChange(false);
  }, [canHover, checked, onChange]);
  if (!canHover) return null;
  return (
    <PropertyRow label={t("hoverAndCapture")} hint={t("hoverHint")}>
      <Toggle label={t("hoverAndCapture")} className="[&>span]:sr-only justify-end"
        checked={checked} onChange={onChange} />
    </PropertyRow>
  );
}

/** The label of a pattern's height field, matching its altitude reference. */
export function useHeightLabel(settings: PatternAltitudeSettings): string {
  const t = useTranslations("planner");
  const ta = useTranslations("planner.pattern.altitude");
  return (settings.altitudeMode ?? "relative") === "relative" ? t("altitudeAboveHome") : ta("heightAboveGround");
}
