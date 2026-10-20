/**
 * @module DefaultsSection
 * @description Default values for new waypoints — altitude, speed, accept
 * radius, and altitude reference frame — as inspector rows. An accept radius
 * of 0 leaves the turn to the flight controller; a fixed-wing plan shows it
 * as WP_RADIUS. PX4 has no terrain frame, so that option is unavailable on a
 * PX4 plan, with the reason on hover.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { PropertyRow } from "@/components/ui/property-row";
import { ScrubNumberField } from "@/components/ui/scrub-number-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { AltitudeFrame, PlanVehicleProfile } from "@/lib/types";

interface DefaultsSectionProps {
  defaultAlt: number;
  defaultSpeed: number;
  defaultAcceptRadius: number;
  defaultFrame: AltitudeFrame;
  /** The profile the plan is written for: decides the radius readout and the frames on offer. */
  vehicleProfile: PlanVehicleProfile;
  onAltChange: (alt: number) => void;
  onSpeedChange: (speed: number) => void;
  onRadiusChange: (radius: number) => void;
  onFrameChange: (frame: AltitudeFrame) => void;
}

/** Smallest value a default may take: every default must stay positive. */
const MIN_POSITIVE = 0.1;

export function DefaultsSection({
  defaultAlt,
  defaultSpeed,
  defaultAcceptRadius,
  defaultFrame,
  vehicleProfile,
  onAltChange,
  onSpeedChange,
  onRadiusChange,
  onFrameChange,
}: DefaultsSectionProps) {
  const t = useTranslations("planner.inspector.defaults");
  const noTerrainFrame = vehicleProfile.autopilot === "px4";
  // A fixed wing at radius 0 turns by the autopilot's own WP_RADIUS.
  const radiusAuto = defaultAcceptRadius === 0 && vehicleProfile.vehicleClass === "plane";

  const frameOptions = useMemo(() => [
    { value: "relative" as const, label: t("frameRel"), title: t("frameRelTitle") },
    { value: "absolute" as const, label: t("frameMsl"), title: t("frameMslTitle") },
    {
      value: "terrain" as const,
      label: t("frameTerrain"),
      title: noTerrainFrame ? t("frameTerrainPx4") : t("frameTerrainTitle"),
      disabled: noTerrainFrame,
    },
  ], [t, noTerrainFrame]);

  return (
    <div className="flex flex-col">
      <PropertyRow label={t("altitude")}>
        <ScrubNumberField value={defaultAlt} step={1} min={MIN_POSITIVE} unit="m"
          ariaLabel={t("altitude")} onCommit={onAltChange} />
      </PropertyRow>
      <PropertyRow label={t("speed")}>
        <ScrubNumberField value={defaultSpeed} step={0.5} min={MIN_POSITIVE} unit="m/s"
          ariaLabel={t("speed")} onCommit={onSpeedChange} />
      </PropertyRow>
      <PropertyRow label={t("acceptRadius")}>
        <ScrubNumberField value={radiusAuto ? undefined : defaultAcceptRadius} step={0.5} min={0} unit="m"
          placeholder={radiusAuto ? t("acceptRadiusAuto") : undefined}
          ariaLabel={t("acceptRadius")} onCommit={onRadiusChange} onClear={() => onRadiusChange(0)} />
      </PropertyRow>
      <PropertyRow label={t("frame")}>
        <SegmentedControl value={defaultFrame} options={frameOptions} onChange={onFrameChange}
          size="sm" stretch ariaLabel={t("frame")} />
      </PropertyRow>
      {defaultFrame === "terrain" && (
        <p className="mt-1 text-[11px] text-text-tertiary">{t("terrainHint")}</p>
      )}
    </div>
  );
}
