/**
 * @module GeofenceEditor
 * @description Geofence configuration panel. Binds directly to geofence-store
 * for enable/type/altitude/action so the drawn boundary, validation, simulation,
 * and FC upload all read the same source of truth.
 * Supports circle/polygon fence types with upload/download to FC.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Toggle } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";
import { PropertyRow } from "@/components/ui/property-row";
import { ScrubNumberField } from "@/components/ui/scrub-number-field";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { useToast } from "@/components/ui/toast";
import { useGeofenceStore } from "@/stores/geofence-store";
import type { FenceType, BreachAction } from "@/stores/geofence-store";
import { usePatternStore } from "@/stores/pattern-store";
import { useMissionStore } from "@/stores/mission-store";
import { useFenceUploadStatus } from "@/hooks/use-upload-status";
import { Upload, Download, Pentagon, Circle, Trash2, ShieldPlus } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePlannerStore } from "@/stores/planner-store";
import { cn } from "@/lib/utils";

const SECONDARY_BUTTON =
  "flex h-7 items-center justify-center gap-1.5 rounded border border-border-default px-2 text-[11px] " +
  "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors cursor-pointer " +
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * Resolve the boundary the auto-fence should wrap. Prefers an active
 * pattern/survey boundary (survey polygon, structure-scan polygon, corridor
 * path) and falls back to the current mission's waypoint set. Returns an empty
 * list when nothing is available.
 */
function resolveBoundaryPoints(): [number, number][] {
  const pattern = usePatternStore.getState();
  const survey = pattern.surveyConfig.polygon;
  if (survey && survey.length >= 3) return survey;
  const structure = pattern.structureScanConfig.structurePolygon;
  if (structure && structure.length >= 3) return structure;
  const corridor = pattern.corridorConfig.pathPoints;
  if (corridor && corridor.length >= 2) return corridor;
  const waypoints = useMissionStore.getState().waypoints;
  if (waypoints.length > 0) {
    return waypoints.map((w) => [w.lat, w.lon] as [number, number]);
  }
  return [];
}

interface GeofenceEditorProps {
  /** Enter a draw tool for the given fence shape. */
  onDrawOnMap?: (type: "polygon" | "circle") => void;
}

export function GeofenceEditor({ onDrawOnMap }: GeofenceEditorProps) {
  const t = useTranslations("geofence");
  const tCommon = useTranslations("common");
  const tEditor = useTranslations("planner.inspector.editor");
  const { toast } = useToast();
  const drawingFence = usePlannerStore((s) => s.mode.kind === "draw" && s.mode.drawingFor === "geofence");

  const [autoFenceBuffer, setAutoFenceBuffer] = useState(50);

  const enabled = useGeofenceStore((s) => s.enabled);
  const fenceType = useGeofenceStore((s) => s.fenceType);
  const maxAltitude = useGeofenceStore((s) => s.maxAltitude);
  const breachAction = useGeofenceStore((s) => s.breachAction);
  const setEnabled = useGeofenceStore((s) => s.setEnabled);
  const setFenceType = useGeofenceStore((s) => s.setFenceType);
  const setMaxAltitude = useGeofenceStore((s) => s.setMaxAltitude);
  const setBreachAction = useGeofenceStore((s) => s.setBreachAction);
  const generateFromBoundary = useGeofenceStore((s) => s.generateFromBoundary);
  const uploadFence = useGeofenceStore((s) => s.uploadFence);
  const downloadFence = useGeofenceStore((s) => s.downloadFence);
  const clearFence = useGeofenceStore((s) => s.clearFence);
  const uploadState = useGeofenceStore((s) => s.uploadState);
  const fenceStatus = useFenceUploadStatus();
  const polygonPoints = useGeofenceStore((s) => s.polygonPoints);
  const circleCenter = useGeofenceStore((s) => s.circleCenter);

  const typeOptions = useMemo<SegmentedOption<FenceType>[]>(() => [
    { value: "circle", label: t("circle"), icon: <Circle size={11} /> },
    { value: "polygon", label: t("polygon"), icon: <Pentagon size={11} /> },
  ], [t]);

  // Short segment labels so three options fit the inspector; the full text is
  // the tooltip.
  const actionOptions = useMemo<SegmentedOption<BreachAction>[]>(() => [
    { value: "RTL", label: tEditor("breachRtlShort"), title: t("rtlOrLand") },
    { value: "LAND", label: tEditor("breachLandShort"), title: t("land") },
    { value: "REPORT", label: tEditor("breachReportShort"), title: t("report") },
  ], [t, tEditor]);

  const hasFenceGeometry =
    fenceType === "polygon" ? polygonPoints.length >= 3 : circleCenter !== null;

  const [confirmClear, setConfirmClear] = useState(false);

  const handleAutoFence = () => {
    const boundary = resolveBoundaryPoints();
    if (boundary.length === 0) {
      toast(t("autoFenceNoBoundary"), "info");
      return;
    }
    generateFromBoundary(boundary, autoFenceBuffer);
  };

  return (
    <div className="flex flex-col gap-1">
      <PropertyRow
        label={t("enableGeofence")}
        trailing={
          <Badge variant={enabled ? "success" : "neutral"} size="sm">
            {enabled ? t("active") : t("off")}
          </Badge>
        }
      >
        <Toggle
          label={t("enableGeofence")}
          checked={enabled}
          onChange={setEnabled}
          className="[&>span]:sr-only"
        />
      </PropertyRow>

      {/* One-click fence around the current mission/pattern boundary. */}
      <PropertyRow
        label={t("autoFenceBuffer")}
        trailing={
          <button type="button" onClick={handleAutoFence} title={t("autoFence")} className={SECONDARY_BUTTON}>
            <ShieldPlus size={12} />
            {t("autoFence")}
          </button>
        }
      >
        <ScrubNumberField
          value={autoFenceBuffer}
          onCommit={setAutoFenceBuffer}
          min={0}
          step={5}
          unit="m"
          ariaLabel={t("autoFenceBuffer")}
        />
      </PropertyRow>

      {enabled && (
        <>
          <PropertyRow label={t("type")}>
            <SegmentedControl
              value={fenceType}
              options={typeOptions}
              onChange={setFenceType}
              size="sm"
              stretch
              ariaLabel={t("type")}
            />
          </PropertyRow>
          {/* Only a positive ceiling reaches the store: an empty field reverts
              instead of silently disabling the FENCE_ALT_MAX check. */}
          <PropertyRow label={t("maxAltitude")}>
            <ScrubNumberField
              value={maxAltitude}
              onCommit={setMaxAltitude}
              min={0.1}
              step={5}
              unit="m"
              ariaLabel={t("maxAltitude")}
            />
          </PropertyRow>
          <PropertyRow label={t("fenceAction")}>
            <SegmentedControl
              value={breachAction}
              options={actionOptions}
              onChange={setBreachAction}
              size="sm"
              stretch
              ariaLabel={t("fenceAction")}
            />
          </PropertyRow>

          {onDrawOnMap && (
            <button
              type="button"
              onClick={() => onDrawOnMap(fenceType === "polygon" ? "polygon" : "circle")}
              aria-pressed={drawingFence}
              className={cn(
                "mt-1 flex h-7 items-center justify-center gap-1.5 rounded-sm border text-[11px] transition-colors cursor-pointer",
                drawingFence
                  ? "border-accent-primary/40 text-accent-primary bg-accent-primary/10"
                  : "border-border-default text-text-secondary hover:bg-bg-tertiary hover:text-text-primary",
              )}
            >
              {fenceType === "polygon" ? <Pentagon size={12} /> : <Circle size={12} />}
              {t("drawOnMap")}
            </button>
          )}

          <p className="text-[11px] text-text-tertiary">
            {fenceType === "polygon" && polygonPoints.length > 0 && (
              <span>{t("fencePointsDefined", { count: polygonPoints.length })}</span>
            )}
            {fenceType === "circle" && circleCenter && <span>{t("circleFenceSet")}</span>}
            {!hasFenceGeometry && <span>{t("noFenceBoundary")}</span>}
          </p>

          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => { void uploadFence().then((r) => { if (!r.success) toast(r.message, "error"); }); }}
              disabled={!hasFenceGeometry}
              className={`${SECONDARY_BUTTON} flex-1`}
            >
              <Upload size={12} />
              {uploadState === "uploading" ? t("uploading") : t("uploadFence")}
            </button>
            <button
              type="button"
              onClick={() => {
                void downloadFence().then((r) => toast(r.message, r.success ? "success" : "error"));
              }}
              className={`${SECONDARY_BUTTON} flex-1`}
            >
              <Download size={12} />
              {t("download")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={!hasFenceGeometry}
              title={t("clearFence")}
              aria-label={t("clearFence")}
              className={`${SECONDARY_BUTTON} hover:text-status-error`}
            >
              <Trash2 size={12} />
            </button>
          </div>

          {fenceStatus === "on-aircraft" && (
            <p className="text-[11px] text-status-success">{t("fenceUploaded")}</p>
          )}
          {fenceStatus === "older-on-aircraft" && uploadState !== "error" && (
            <p className="text-[11px] text-status-warning">{t("olderFenceOnAircraft")}</p>
          )}
          {uploadState === "error" && (
            <p className="text-[11px] text-status-error">{t("uploadFailed")}</p>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmClear}
        title={t("clearFence")}
        message={t("clearFenceConfirm")}
        variant="danger"
        confirmLabel={tCommon("delete")}
        onConfirm={() => { setConfirmClear(false); clearFence(); }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
