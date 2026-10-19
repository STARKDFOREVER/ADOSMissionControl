"use client";

/**
 * @module TransformPanel
 * @description Mission transform tools: move, rotate, scale, and mirror entire
 * missions. Rotate and scale operate around the mission centroid by default, or
 * around an operator-entered pivot point.
 * @license GPL-3.0-only
 */

import { useState, useCallback, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Move, RotateCw, Maximize2, FlipHorizontal, FlipHorizontal2, FlipVertical2, Crosshair } from "lucide-react";
import { PropertyRow } from "@/components/ui/property-row";
import { ScrubNumberField } from "@/components/ui/scrub-number-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toggle } from "@/components/ui/toggle";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useMissionStore } from "@/stores/mission-store";
import { useToast } from "@/components/ui/toast";
import {
  moveMissionByBearing,
  rotateMission,
  rotateMissionAroundPoint,
  scaleMission,
  scaleMissionFromPoint,
  mirrorMission,
} from "@/lib/transforms/mission-transforms";
import type { Waypoint } from "@/lib/types";

type MirrorAxis = "lat" | "lon";
type PendingAction = "move" | "rotate" | "scale" | "mirror" | null;

const APPLY_BUTTON =
  "flex h-7 items-center justify-center rounded border border-border-default px-2 text-[11px] " +
  "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors cursor-pointer " +
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

function GroupHeading({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-6 items-center gap-1.5 text-[11px] font-semibold text-text-tertiary">
      {icon}
      <span>{children}</span>
    </div>
  );
}

export function TransformPanel() {
  const t = useTranslations("transform");
  const tPlanner = useTranslations("planner");
  const tEditor = useTranslations("planner.inspector.editor");
  const waypoints = useMissionStore((s) => s.waypoints);
  const setWaypoints = useMissionStore((s) => s.setWaypoints);
  const { toast } = useToast();

  // Move controls
  const [moveBearing, setMoveBearing] = useState(0);
  const [moveDistance, setMoveDistance] = useState(100);

  // Rotate controls
  const [rotateAngle, setRotateAngle] = useState(45);

  // Scale controls
  const [scaleFactor, setScaleFactor] = useState(1.5);

  // Optional custom pivot for rotate + scale (defaults to the mission centroid)
  const [useCustomCenter, setUseCustomCenter] = useState(false);
  const [centerLat, setCenterLat] = useState(0);
  const [centerLon, setCenterLon] = useState(0);

  // Mirror controls
  const [mirrorAxis, setMirrorAxis] = useState<MirrorAxis>("lat");

  // Confirm dialog
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const setCustomCenter = useCallback((next: boolean) => {
    // Seed the pivot with the current mission centroid the first time it is
    // enabled so the operator edits a sensible starting point.
    if (next && waypoints.length > 0) {
      const meanLat = waypoints.reduce((s, w) => s + w.lat, 0) / waypoints.length;
      const meanLon = waypoints.reduce((s, w) => s + w.lon, 0) / waypoints.length;
      setCenterLat(Number(meanLat.toFixed(6)));
      setCenterLon(Number(meanLon.toFixed(6)));
    }
    setUseCustomCenter(next);
  }, [waypoints]);

  const handleMove = useCallback(() => {
    if (waypoints.length === 0) return;
    const moved = moveMissionByBearing(waypoints, moveBearing, moveDistance);
    setWaypoints(moved as Waypoint[]);
    toast(tEditor("movedToast", { distance: moveDistance, bearing: moveBearing }), "success");
  }, [waypoints, moveBearing, moveDistance, setWaypoints, toast, tEditor]);

  const handleRotate = useCallback(() => {
    if (waypoints.length === 0) return;
    const rotated = useCustomCenter
      ? rotateMissionAroundPoint(waypoints, rotateAngle, centerLat, centerLon)
      : rotateMission(waypoints, rotateAngle);
    setWaypoints(rotated as Waypoint[]);
    toast(tEditor("rotatedToast", { angle: rotateAngle }), "success");
  }, [waypoints, rotateAngle, useCustomCenter, centerLat, centerLon, setWaypoints, toast, tEditor]);

  const handleScale = useCallback(() => {
    if (waypoints.length === 0) return;
    const scaled = useCustomCenter
      ? scaleMissionFromPoint(waypoints, scaleFactor, centerLat, centerLon)
      : scaleMission(waypoints, scaleFactor);
    setWaypoints(scaled as Waypoint[]);
    toast(tEditor("scaledToast", { factor: scaleFactor }), "success");
  }, [waypoints, scaleFactor, useCustomCenter, centerLat, centerLon, setWaypoints, toast, tEditor]);

  const handleMirror = useCallback(() => {
    if (waypoints.length === 0) return;
    const mirrored = mirrorMission(waypoints, mirrorAxis);
    setWaypoints(mirrored as Waypoint[]);
    toast(tEditor(mirrorAxis === "lat" ? "mirroredHorizontalToast" : "mirroredVerticalToast"), "success");
  }, [waypoints, mirrorAxis, setWaypoints, toast, tEditor]);

  const confirmTransform = useCallback(() => {
    if (pendingAction === "move") handleMove();
    else if (pendingAction === "rotate") handleRotate();
    else if (pendingAction === "scale") handleScale();
    else if (pendingAction === "mirror") handleMirror();
    setPendingAction(null);
  }, [pendingAction, handleMove, handleRotate, handleScale, handleMirror]);

  const count = waypoints.length;
  const confirmMessage = pendingAction === "move"
    ? tEditor("confirmMove", { count, distance: moveDistance, bearing: moveBearing })
    : pendingAction === "rotate"
      ? tEditor("confirmRotate", { count, angle: rotateAngle })
      : pendingAction === "scale"
        ? tEditor("confirmScale", { count, factor: scaleFactor })
        : pendingAction === "mirror"
          ? tEditor(mirrorAxis === "lat" ? "confirmMirrorHorizontal" : "confirmMirrorVertical", { count })
          : "";

  const disabled = waypoints.length < 2;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col">
        <GroupHeading icon={<Move size={12} />}>{t("move")}</GroupHeading>
        <PropertyRow label={t("bearing")}>
          <ScrubNumberField value={moveBearing} onCommit={setMoveBearing} min={0} max={360}
            step={15} precision={1} unit="°" ariaLabel={t("bearing")} />
        </PropertyRow>
        <PropertyRow
          label={tPlanner("distance")}
          trailing={
            <button type="button" className={APPLY_BUTTON} onClick={() => setPendingAction("move")} disabled={disabled}>
              {t("move")}
            </button>
          }
        >
          <ScrubNumberField value={moveDistance} onCommit={setMoveDistance} min={1} max={100000}
            step={50} precision={1} unit="m" ariaLabel={tPlanner("distance")} />
        </PropertyRow>
      </div>

      <div className="flex flex-col">
        <GroupHeading icon={<RotateCw size={12} />}>{t("rotate")}</GroupHeading>
        <PropertyRow
          label={tPlanner("angle")}
          trailing={
            <button type="button" className={APPLY_BUTTON} onClick={() => setPendingAction("rotate")} disabled={disabled}>
              {t("rotate")}
            </button>
          }
        >
          <ScrubNumberField value={rotateAngle} onCommit={setRotateAngle} min={-360} max={360}
            step={15} precision={1} unit="°" ariaLabel={tPlanner("angle")} />
        </PropertyRow>
      </div>

      <div className="flex flex-col">
        <GroupHeading icon={<Maximize2 size={12} />}>{t("scale")}</GroupHeading>
        <PropertyRow
          label={t("scaleFactor")}
          trailing={
            <button type="button" className={APPLY_BUTTON} onClick={() => setPendingAction("scale")} disabled={disabled}>
              {t("scale")}
            </button>
          }
        >
          <ScrubNumberField value={scaleFactor} onCommit={setScaleFactor} min={0.1} max={10}
            step={0.1} precision={2} unit="x" ariaLabel={t("scaleFactor")} />
        </PropertyRow>
      </div>

      {/* Custom pivot for rotate + scale */}
      <div className="flex flex-col">
        <GroupHeading icon={<Crosshair size={12} />}>{t("pivot")}</GroupHeading>
        <PropertyRow label={t("customPivot")} hint={t("pivotHint")}>
          <Toggle
            label={t("customPivot")}
            checked={useCustomCenter}
            onChange={setCustomCenter}
            className="[&>span]:sr-only"
          />
        </PropertyRow>
        {useCustomCenter && (
          <>
            <PropertyRow label={t("pivotLat")}>
              <ScrubNumberField value={centerLat} onCommit={setCenterLat} min={-90} max={90}
                step={0.0001} precision={6} ariaLabel={t("pivotLat")} />
            </PropertyRow>
            <PropertyRow label={t("pivotLon")}>
              <ScrubNumberField value={centerLon} onCommit={setCenterLon} min={-180} max={180}
                step={0.0001} precision={6} ariaLabel={t("pivotLon")} />
            </PropertyRow>
            <p className="pt-1 text-[11px] text-text-tertiary">{t("pivotHint")}</p>
          </>
        )}
      </div>

      <div className="flex flex-col">
        <GroupHeading icon={<FlipHorizontal size={12} />}>{t("mirror")}</GroupHeading>
        <PropertyRow
          label={t("axis")}
          trailing={
            <button type="button" className={APPLY_BUTTON} onClick={() => setPendingAction("mirror")} disabled={disabled}>
              {t("mirror")}
            </button>
          }
        >
          <SegmentedControl
            value={mirrorAxis}
            onChange={setMirrorAxis}
            options={[
              // Icons show the mirror axis (a horizontal or vertical line); the
              // words don't fit beside the Mirror button, so they are the title.
              { value: "lat", label: t("horizontal"), title: t("horizontal"), icon: <FlipVertical2 size={13} />, iconOnly: true },
              { value: "lon", label: t("vertical"), title: t("vertical"), icon: <FlipHorizontal2 size={13} />, iconOnly: true },
            ]}
            size="sm"
            stretch
            ariaLabel={t("axis")}
          />
        </PropertyRow>
      </div>

      {disabled && <p className="text-[11px] text-text-tertiary">{t("minWaypointsHint")}</p>}

      <ConfirmDialog
        open={pendingAction !== null}
        onConfirm={confirmTransform}
        onCancel={() => setPendingAction(null)}
        title={t("applyTransform")}
        message={confirmMessage}
        confirmLabel={t("apply")}
      />
    </div>
  );
}
