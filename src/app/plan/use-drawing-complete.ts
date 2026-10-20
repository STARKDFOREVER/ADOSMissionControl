/**
 * @module use-drawing-complete
 * @description Routes a completed map drawing to the store it was drawn for:
 * the geofence, the armed pattern, or a free sketch.
 * @license GPL-3.0-only
 */

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { usePatternStore } from "@/stores/pattern-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useDrawingStore } from "@/stores/drawing-store";
import type { DrawnPolygon, DrawnCircle, DrawnPolyline } from "@/lib/drawing/types";
import type { DrawingFor } from "@/lib/planner-mode";
import type { PlannerToast } from "./use-planner-state";

export function useDrawingComplete(toast: PlannerToast) {
  const t = useTranslations("planner.toast");

  return useCallback(
    (shape: DrawnPolygon | DrawnCircle | DrawnPolyline) => {
      const patternStore = usePatternStore.getState();
      const patternType = patternStore.activePatternType;
      const geoStore = useGeofenceStore.getState();
      const drawingStore = useDrawingStore.getState();
      const showPattern = () => usePlannerStore.getState().setInspectorTarget({ kind: "pattern" });

      // Route the completed shape by the explicit destination tag carried on the
      // current draw mode, not by inferring intent from which sibling stores
      // happen to be active. PlannerMap completes the draw and only resets the
      // tool to select AFTER this callback runs, so the mode here is still the
      // draw mode and its `drawingFor` tag is authoritative. A non-draw mode
      // (defensive) is treated as a free-hand draw.
      const mode = usePlannerStore.getState().mode;
      const drawingFor: DrawingFor = mode.kind === "draw" ? mode.drawingFor : "free";
      // The pattern flow either tags the draw as `"pattern"` or leaves it
      // `"free"` while a pattern is armed; both feed the active pattern.
      const routeToPattern = drawingFor === "pattern" || (drawingFor === "free" && patternType !== null);

      if ("points" in shape) {
        // An open line feeds the line patterns; with none armed it was a free sketch.
        if (routeToPattern && patternType === "corridor") {
          patternStore.updateCorridorConfig({ pathPoints: shape.points });
          showPattern();
          toast(t("corridorPathSet", { count: shape.points.length }), "success");
        } else if (routeToPattern && patternType === "facade") {
          patternStore.updateFacadeConfig({ pathPoints: shape.points.slice(0, 2) });
          showPattern();
          toast(t("facadeLineSet"), "success");
        } else {
          toast(t("lineDrawn", { count: shape.points.length }), "info");
        }
      } else if ("vertices" in shape) {
        const count = shape.vertices.length;
        if (drawingFor === "geofence") {
          // Tagged for the fence: set it unconditionally (a concurrently-armed
          // pattern no longer steals the shape). Preserve the [lat, lon] vertex
          // order exactly — a swapped order uploads a wrong fence to the FC.
          geoStore.setFenceType("polygon");
          geoStore.setPolygonPoints(shape.vertices);
          geoStore.setEnabled(true);
          // The fence now renders from the geofence store; drop the raw drawn
          // shape so the polygon is not painted twice.
          drawingStore.removePolygon(shape.id);
          toast(t("fencePolygonSet", { count }), "success");
        } else if (routeToPattern && patternType === "survey") {
          patternStore.updateSurveyConfig({ polygon: shape.vertices });
          showPattern();
          // The boundary now renders from the pattern config; drop the raw drawn
          // polygon so the ring is not painted twice.
          drawingStore.removePolygon(shape.id);
          toast(t("surveyAreaSet", { count }), "success");
        } else if (routeToPattern && patternType === "structureScan") {
          patternStore.updateStructureScanConfig({ structurePolygon: shape.vertices });
          showPattern();
          drawingStore.removePolygon(shape.id);
          toast(t("structureSet", { count }), "success");
        } else if (routeToPattern && patternType === "corridor") {
          // A corridor drawn as a closed shape still gives its center line.
          patternStore.updateCorridorConfig({ pathPoints: shape.vertices });
          showPattern();
          drawingStore.removePolygon(shape.id);
          toast(t("corridorPathSet", { count }), "success");
        } else {
          toast(t("polygonDrawn", { count }), "success");
        }
      } else {
        const radius = Math.round(shape.radius);
        if (drawingFor === "geofence") {
          geoStore.setFenceType("circle");
          geoStore.setCircle(shape.center, shape.radius);
          geoStore.setEnabled(true);
          drawingStore.removeCircle(shape.id);
          toast(t("fenceCircleSet", { radius }), "success");
        } else if (routeToPattern && patternType === "orbit") {
          patternStore.updateOrbitConfig({ center: shape.center, radius: shape.radius });
          showPattern();
          // The orbit renders from its config circle; drop the raw drawn circle.
          drawingStore.removeCircle(shape.id);
          toast(t("orbitSet", { radius }), "success");
        } else {
          toast(t("circleDrawn", { radius }), "success");
        }
      }
    },
    [toast, t],
  );
}
