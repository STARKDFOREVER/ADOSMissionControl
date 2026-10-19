/**
 * @module DefaultsSection
 * @description Default values for new waypoints — altitude, speed, accept
 * radius, and altitude reference frame — as inspector rows.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { PropertyRow } from "@/components/ui/property-row";
import { ScrubNumberField } from "@/components/ui/scrub-number-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { AltitudeFrame } from "@/lib/types";

interface DefaultsSectionProps {
  defaultAlt: number;
  defaultSpeed: number;
  defaultAcceptRadius: number;
  defaultFrame: AltitudeFrame;
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
  onAltChange,
  onSpeedChange,
  onRadiusChange,
  onFrameChange,
}: DefaultsSectionProps) {
  const t = useTranslations("planner.inspector.defaults");

  const frameOptions = useMemo(() => [
    { value: "relative" as const, label: t("frameRel"), title: t("frameRelTitle") },
    { value: "absolute" as const, label: t("frameMsl"), title: t("frameMslTitle") },
    { value: "terrain" as const, label: t("frameTerrain"), title: t("frameTerrainTitle") },
  ], [t]);

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
        <ScrubNumberField value={defaultAcceptRadius} step={0.5} min={MIN_POSITIVE} unit="m"
          ariaLabel={t("acceptRadius")} onCommit={onRadiusChange} />
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
