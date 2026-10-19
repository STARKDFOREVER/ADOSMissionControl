/**
 * @module FixedWingLandingConfigSection
 * @description Fixed-wing landing pattern configuration UI.
 * Exposes the landing point, final-approach heading, glide slope, approach
 * altitude and speed for the straight-in approach and landing sequence. The
 * approach distance follows from the altitude and glide slope and is shown,
 * not edited.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { PropertyRow } from "@/components/ui/property-row";
import { usePatternStore } from "@/stores/pattern-store";
import { fixedWingApproachDistance, landingApproachHeading } from "@/lib/patterns/landing-generator";
import { LandingPointPicker } from "./LandingPointPicker";
import { PatternNumberRow } from "./PatternNumberRow";

export function FixedWingLandingConfig() {
  const t = useTranslations("planner");
  const config = usePatternStore((s) => s.fixedWingLandingConfig);
  const update = usePatternStore((s) => s.updateFixedWingLandingConfig);
  const approachDistance = fixedWingApproachDistance(config.loiterAltitude ?? 60, config.glideSlopeAngle ?? 5);
  return (
    <div className="flex flex-col">
      <LandingPointPicker
        landingPoint={config.landingPoint}
        onChange={(landingPoint) => update({ landingPoint })}
      />
      <PatternNumberRow label={t("approachHeading")} unit="deg" step={1} min={0} max={360} placeholder="0-360"
        value={config.approachHeading} onCommit={(approachHeading) => update({ approachHeading })}
        onClear={() => update({ approachHeading: undefined })} />
      {landingApproachHeading(config.approachHeading) === null && (
        <p className="py-0.5 text-[11px] text-status-warning">{t("approachHeadingRequired")}</p>
      )}
      <PatternNumberRow label={t("glideSlopeAngle")} unit="deg" step={0.5} min={0.5} max={45}
        value={config.glideSlopeAngle ?? 5} onCommit={(glideSlopeAngle) => update({ glideSlopeAngle })} />
      <PatternNumberRow label={t("loiterAltitude")} hint={t("aboveHome")} unit="m" step={1} min={1}
        value={config.loiterAltitude ?? 60} onCommit={(loiterAltitude) => update({ loiterAltitude })} />
      <PatternNumberRow label={t("speed")} unit="m/s" step={0.5} min={0.1}
        value={config.speed ?? 15} onCommit={(speed) => update({ speed })} />
      <PropertyRow label={t("approachDistance")}>
        <span className="block truncate font-mono text-xs text-text-primary">
          {approachDistance === null ? "—" : `${Math.round(approachDistance)} m`}
        </span>
      </PropertyRow>
    </div>
  );
}
