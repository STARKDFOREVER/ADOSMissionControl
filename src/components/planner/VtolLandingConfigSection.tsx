/**
 * @module VtolLandingConfigSection
 * @description VTOL landing pattern configuration UI.
 * Exposes the landing point, final-approach heading, transition distance and
 * approach altitude for the cruise -> transition -> vertical-landing sequence.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { usePatternStore } from "@/stores/pattern-store";
import { landingApproachHeading } from "@/lib/patterns/landing-generator";
import { LandingPointPicker } from "./LandingPointPicker";
import { PatternNumberRow } from "./PatternNumberRow";

export function VtolLandingConfig() {
  const t = useTranslations("planner");
  const config = usePatternStore((s) => s.vtolLandingConfig);
  const update = usePatternStore((s) => s.updateVtolLandingConfig);
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
      <PatternNumberRow label={t("transitionDistance")} unit="m" step={5} min={1}
        value={config.transitionDistance ?? 150} onCommit={(transitionDistance) => update({ transitionDistance })} />
      <PatternNumberRow label={t("approachAltitude")} hint={t("aboveHome")} unit="m" step={1} min={1}
        value={config.approachAltitude ?? 50} onCommit={(approachAltitude) => update({ approachAltitude })} />
      <PatternNumberRow label={t("descentSpeed")} unit="m/s" step={0.1} min={0.1}
        value={config.descentSpeed ?? 2} onCommit={(descentSpeed) => update({ descentSpeed })} />
      <PatternNumberRow label={t("speed")} unit="m/s" step={0.5} min={0.1}
        value={config.speed ?? 8} onCommit={(speed) => update({ speed })} />
    </div>
  );
}
