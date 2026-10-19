/**
 * @module use-planner-share-import
 * @description Plan sharing and boundary import for the planner bar: the
 * flight-brief PDF export, the copy-share-link action and the KML/KMZ/shapefile
 * boundary import with its hidden file input.
 * @license GPL-3.0-only
 */
"use client";

import { createElement, useCallback, useId, type ChangeEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useFlightPlanOptions } from "@/hooks/use-rtl-return-context";
import { useToast } from "@/components/ui/toast";
import { useDrawingStore } from "@/stores/drawing-store";
import { usePatternStore } from "@/stores/pattern-store";
import { importBoundaryFile } from "@/lib/mission-io";
import { ShapefileNotGeographicError } from "@/lib/formats/shp-import";
import { exportFlightBrief } from "@/lib/pdf/export-flight-brief";
import { polygonArea } from "@/lib/drawing/geo-utils";
import { buildMissionFile, makeShareLink, buildShareUrl } from "@/lib/plan-share";
import { capturePlanExtras } from "@/lib/plan-workspace";
import { randomId } from "@/lib/utils";
import type { Planner } from "./use-planner";

export interface PlannerShareImport {
  /** Hidden file input the boundary import opens; render it once in the page. */
  boundaryInput: ReactNode;
  handleImportBoundary: () => void;
  handleExportBrief: () => void;
  handleCopyShareLink: () => Promise<void>;
}

export function usePlannerShareImport(p: Planner): PlannerShareImport {
  const t = useTranslations("planner");

  // Flight-brief PDF export: real computed stats from the current plan.
  const { toast } = useToast();
  const droneName = p.drones.find((d) => d.id === p.selectedDroneId)?.name;
  const planOptions = useFlightPlanOptions();
  const handleExportBrief = useCallback(() => {
    void exportFlightBrief({
      waypoints: p.waypoints,
      name: p.missionName || t("untitledMission"),
      droneName,
      defaultSpeed: p.defaultSpeed,
      defaultFrame: p.defaultFrame,
      planOptions,
    });
  }, [p.waypoints, p.missionName, droneName, p.defaultSpeed, p.defaultFrame, planOptions, t]);

  // Boundary import (KML/KMZ/shapefile): push each real parsed ring into the
  // drawing store as a survey boundary, and each interior ring (hole) as a
  // polygon marked as a survey keep-out. A file with no polygon warns, never fakes.
  // Found by id rather than a ref: the input is returned as an element for the
  // page to render, and a ref handed out during render is unsafe to read.
  const boundaryInputId = useId();
  const handleImportBoundary = useCallback(
    () => (document.getElementById(boundaryInputId) as HTMLInputElement | null)?.click(),
    [boundaryInputId],
  );

  // Client-only share link: encode the whole plan into the URL fragment + copy it.
  // Nothing is uploaded; too-large plans fall back to file export with an honest note.
  const handleCopyShareLink = useCallback(async () => {
    const now = Date.now();
    const file = buildMissionFile(
      p.waypoints,
      { name: p.missionName || t("untitledMission"), createdAt: now, updatedAt: now },
      capturePlanExtras(),
    );
    const link = makeShareLink(file);
    if (link.tooLarge || !link.encoded) {
      toast(t("share.tooLarge"), "warning");
      return;
    }
    try {
      const url = buildShareUrl(window.location.origin, window.location.pathname, link.encoded);
      await navigator.clipboard.writeText(url);
      toast(t("share.copied"), "success");
    } catch {
      toast(t("share.copyFailed"), "error");
    }
  }, [p.waypoints, p.missionName, t, toast]);

  const handleBoundaryFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const boundaries = await importBoundaryFile(file);
      if (boundaries.length === 0) {
        toast(t("import.boundary.noPolygon"), "warning");
        return;
      }
      const add = useDrawingStore.getState().addPolygon;
      // Holes first, boundaries last: a survey with no selection takes the most
      // recently drawn polygon, which must be a boundary, not a keep-out.
      const holeIds: string[] = [];
      for (const { holes } of boundaries) {
        for (const vertices of holes) {
          const id = randomId();
          add({ id, vertices, area: polygonArea(vertices) });
          holeIds.push(id);
        }
      }
      for (const { outer } of boundaries) {
        add({ id: randomId(), vertices: outer, area: polygonArea(outer) });
      }
      if (holeIds.length > 0) {
        const patterns = usePatternStore.getState();
        patterns.setExclusionPolygonIds([...patterns.exclusionPolygonIds, ...holeIds]);
      }
      toast(t("import.boundary.success", { count: boundaries.length }), "success");
      if (holeIds.length > 0) toast(t("import.boundary.holesAsKeepOut", { count: holeIds.length }), "info");
    } catch (err) {
      if (err instanceof ShapefileNotGeographicError) {
        toast(t("import.boundary.needsPrj"), "warning");
        return;
      }
      toast(t("import.boundary.error"), "error");
    }
  }, [t, toast]);

  const boundaryInput = createElement("input", {
    id: boundaryInputId,
    type: "file",
    accept: ".kml,.kmz,.zip,.shp",
    hidden: true,
    "data-testid": "boundary-import-input",
    onChange: (e: ChangeEvent<HTMLInputElement>) => { void handleBoundaryFile(e); },
  });

  return { boundaryInput, handleImportBoundary, handleExportBrief, handleCopyShareLink };
}
