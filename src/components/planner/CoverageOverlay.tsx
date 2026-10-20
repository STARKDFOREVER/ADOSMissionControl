/**
 * @module CoverageOverlay
 * @description Draws the ground footprint of each camera capture of the survey
 * being configured, so the operator can see where images overlap and where gaps
 * open up. Display-only. The captures come from the generated pattern route (the
 * one the toggle sits beside): every trigger-distance step along each armed leg,
 * at that point's own altitude. Renders nothing unless the coverage toggle is
 * on, a camera is selected and a pattern has been generated. At most
 * `MAX_FOOTPRINTS` are drawn; `useCoverageCaptures` reports the full
 * count so the survey panel can say when the overlay is truncated.
 * Must render inside a react-leaflet MapContainer.
 * @license GPL-3.0-only
 */
"use client";

import { memo, useMemo } from "react";
import { Polygon } from "react-leaflet";
import { usePatternStore } from "@/stores/pattern-store";
import { findCamera } from "@/lib/patterns/gsd-calculator";
import { useSettingsStore } from "@/stores/settings-store";
import { MAP_COLORS } from "@/lib/map-constants";
import { buildFootprintPolygons } from "@/lib/patterns/coverage-footprints";
import { useCoverageCaptures } from "@/hooks/use-coverage-captures";

const FOOTPRINT_STYLE = {
  color: MAP_COLORS.coverage,
  weight: 0.5,
  opacity: 0.6,
  fillColor: MAP_COLORS.coverage,
  fillOpacity: 0.12,
  interactive: false,
};

export const CoverageOverlay = memo(function CoverageOverlay() {
  const showCoverageOverlay = usePatternStore((s) => s.showCoverageOverlay);
  const cameraName = usePatternStore((s) => s.surveyConfig._cameraName);
  const orientation = usePatternStore((s) => s.surveyConfig._orientation);
  // In the terrain modes the rows carry sea-level or terrain altitudes; the
  // footprint is sized by the height above ground the survey holds.
  const heightAboveGround = usePatternStore((s) =>
    (s.surveyConfig.altitudeMode ?? "relative") === "relative" ? null : s.surveyConfig.altitude ?? null);
  const customCameras = useSettingsStore((s) => s.customCameras);
  const { points } = useCoverageCaptures();

  const footprints = useMemo(() => {
    if (!showCoverageOverlay) return [];
    const camera = findCamera(cameraName, customCameras);
    if (!camera) return [];
    const sized = heightAboveGround === null ? points : points.map((p) => ({ ...p, alt: heightAboveGround }));
    return buildFootprintPolygons(sized, camera, orientation);
  }, [showCoverageOverlay, cameraName, customCameras, orientation, heightAboveGround, points]);

  if (footprints.length === 0) return null;

  return (
    <>
      {footprints.map((positions, i) => (
        <Polygon key={i} positions={positions} pathOptions={FOOTPRINT_STYLE} />
      ))}
    </>
  );
});
