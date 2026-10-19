"use client";

/**
 * @module outline/PlanOutline
 * @description The planner's left panel: every object in the plan, grouped
 * (mission waypoints, drawn shapes, geofence, rally points, POIs). Clicking a
 * row or a group header points the inspector at it; each group's `+` starts
 * adding to that group.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Circle, Flag, Hexagon, MapPin, Shield } from "lucide-react";
import type { Planner } from "@/app/plan/use-planner";
import { usePlannerStore, type InspectorTarget } from "@/stores/planner-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import { usePlanPoiStore } from "@/stores/plan-poi-store";
import { OutlineGroup } from "./OutlineGroup";
import { OutlineEmpty, OutlineItemRow } from "./OutlineItemRow";
import { OutlineMissionList } from "./OutlineMissionList";

/** Show `target` in the inspector, opening the inspector if it is closed. */
function openTarget(target: InspectorTarget) {
  const s = usePlannerStore.getState();
  if (target.kind === "mission") s.clearSelection();
  s.setInspectorTarget(target);
  if (!s.inspectorOpen) s.toggleInspector();
}

interface PlanOutlineProps {
  p: Planner;
  showGeofence: boolean;
  showRally: boolean;
}

export function PlanOutline({ p, showGeofence, showRally }: PlanOutlineProps) {
  const t = useTranslations("planner");
  const target = usePlannerStore((s) => s.inspectorTarget);
  const multiCount = usePlannerStore((s) => s.selectedWaypointIds.length);
  const hasWaypointSelection = p.selectedWaypointId !== null || multiCount > 0;

  return (
    <nav aria-label={t("outline.label")} className="flex h-full flex-col overflow-y-auto py-1">
      <OutlineGroup
        id="mission"
        title={t("outline.mission")}
        meta={p.waypoints.length}
        active={!hasWaypointSelection && target.kind === "mission"}
        onSelect={() => openTarget({ kind: "mission" })}
        onAdd={p.handleAddManualWaypoint}
        addLabel={t("addWaypoint")}
      >
        <OutlineMissionList
          waypoints={p.waypoints}
          selectedId={p.selectedWaypointId}
          onClick={p.handleWaypointClick}
          onRemove={p.removeWaypoint}
          onReorder={p.reorderWaypoints}
          onInsertAt={p.handleInsertAt}
        />
      </OutlineGroup>
      <ShapesGroup active={target.kind === "pattern"} />
      {showGeofence && <GeofenceGroup active={target.kind === "geofence"} />}
      {showRally && <RallyGroup activeId={target.kind === "rally" ? target.id : undefined} />}
      <PoiGroup activeId={target.kind === "poi" ? target.id : undefined} />
    </nav>
  );
}

function ShapesGroup({ active }: { active: boolean }) {
  const t = useTranslations("planner.outline");
  const polygons = useDrawingStore((s) => s.polygons);
  const circles = useDrawingStore((s) => s.circles);
  const openPattern = () => openTarget({ kind: "pattern" });

  return (
    <OutlineGroup
      id="shapes"
      title={t("shapes")}
      meta={polygons.length + circles.length}
      active={active}
      onSelect={openPattern}
    >
      {polygons.length + circles.length === 0 && <OutlineEmpty>{t("noShapes")}</OutlineEmpty>}
      {polygons.map((poly, i) => (
        <OutlineItemRow
          key={poly.id}
          icon={<Hexagon size={12} />}
          label={t("polygonItem", { n: i + 1 })}
          detail={poly.area >= 10_000
            ? t("areaHa", { value: (poly.area / 10_000).toFixed(1) })
            : t("areaM2", { value: Math.round(poly.area) })}
          active={false}
          onSelect={openPattern}
          onRemove={() => useDrawingStore.getState().removePolygon(poly.id)}
          removeLabel={t("deleteItem", { name: t("polygonItem", { n: i + 1 }) })}
        />
      ))}
      {circles.map((circle, i) => (
        <OutlineItemRow
          key={circle.id}
          icon={<Circle size={12} />}
          label={t("circleItem", { n: i + 1 })}
          detail={t("radius", { value: Math.round(circle.radius) })}
          active={false}
          onSelect={openPattern}
          onRemove={() => useDrawingStore.getState().removeCircle(circle.id)}
          removeLabel={t("deleteItem", { name: t("circleItem", { n: i + 1 }) })}
        />
      ))}
    </OutlineGroup>
  );
}

function GeofenceGroup({ active }: { active: boolean }) {
  const t = useTranslations("planner.outline");
  const enabled = useGeofenceStore((s) => s.enabled);
  const fenceType = useGeofenceStore((s) => s.fenceType);
  const polygonPoints = useGeofenceStore((s) => s.polygonPoints);
  const circleCenter = useGeofenceStore((s) => s.circleCenter);
  const circleRadius = useGeofenceStore((s) => s.circleRadius);
  const zones = useGeofenceStore((s) => s.zones);
  const openFence = () => openTarget({ kind: "geofence" });
  const armDraw = () => {
    usePlannerStore.getState().setMode({ kind: "draw", shape: "polygon", drawingFor: "geofence" });
    openFence();
  };

  const hasBoundary = fenceType === "polygon" ? polygonPoints.length >= 3 : circleCenter !== null;

  return (
    <OutlineGroup
      id="geofence"
      title={t("geofence")}
      meta={enabled ? t("fenceOn") : t("fenceOff")}
      active={active}
      onSelect={openFence}
      onAdd={armDraw}
      addLabel={t("drawGeofence")}
    >
      {!hasBoundary && zones.length === 0 && <OutlineEmpty>{t("noFence")}</OutlineEmpty>}
      {hasBoundary && (
        <OutlineItemRow
          icon={<Shield size={12} />}
          label={t("fenceBoundary")}
          detail={fenceType === "polygon"
            ? t("points", { count: polygonPoints.length })
            : t("radius", { value: Math.round(circleRadius) })}
          active={false}
          onSelect={openFence}
        />
      )}
      {zones.map((zone, i) => {
        const name = zone.role === "inclusion"
          ? t("zoneInclusion", { n: i + 1 })
          : t("zoneExclusion", { n: i + 1 });
        return (
          <OutlineItemRow
            key={zone.id}
            icon={zone.type === "circle" ? <Circle size={12} /> : <Hexagon size={12} />}
            label={name}
            detail={zone.type === "circle"
              ? t("radius", { value: Math.round(zone.circleRadius) })
              : t("points", { count: zone.polygonPoints.length })}
            active={false}
            onSelect={openFence}
            onRemove={() => useGeofenceStore.getState().removeZone(zone.id)}
            removeLabel={t("deleteItem", { name })}
          />
        );
      })}
    </OutlineGroup>
  );
}

/** `activeId`: undefined = group not targeted, null = group header targeted. */
function RallyGroup({ activeId }: { activeId: string | null | undefined }) {
  const t = useTranslations("planner.outline");
  const points = useRallyStore((s) => s.points);
  const setActiveTool = usePlannerStore((s) => s.setActiveTool);

  return (
    <OutlineGroup
      id="rally"
      title={t("rally")}
      meta={points.length}
      active={activeId === null}
      onSelect={() => openTarget({ kind: "rally", id: null })}
      onAdd={() => setActiveTool("rally")}
      addLabel={t("addRally")}
    >
      {points.length === 0 && <OutlineEmpty>{t("noRally")}</OutlineEmpty>}
      {points.map((pt, i) => {
        const name = t("rallyItem", { n: i + 1 });
        return (
          <OutlineItemRow
            key={pt.id}
            icon={<Flag size={12} />}
            label={name}
            detail={t("altitude", { value: pt.alt })}
            active={activeId === pt.id}
            onSelect={() => openTarget({ kind: "rally", id: pt.id })}
            onRemove={() => useRallyStore.getState().removePoint(pt.id)}
            removeLabel={t("deleteItem", { name })}
          />
        );
      })}
    </OutlineGroup>
  );
}

function PoiGroup({ activeId }: { activeId: string | null | undefined }) {
  const t = useTranslations("planner.outline");
  const points = usePlanPoiStore((s) => s.points);
  const setActiveTool = usePlannerStore((s) => s.setActiveTool);
  const openPoi = (id: string | null) => {
    openTarget({ kind: "poi", id });
    if (id) usePlanPoiStore.getState().select(id);
  };

  return (
    <OutlineGroup
      id="poi"
      title={t("poi")}
      meta={points.length}
      active={activeId === null}
      onSelect={() => openPoi(null)}
      onAdd={() => setActiveTool("poi")}
      addLabel={t("addPoi")}
    >
      {points.length === 0 && <OutlineEmpty>{t("noPoi")}</OutlineEmpty>}
      {points.map((pt, i) => {
        const name = pt.label?.trim() || t("poiItem", { n: i + 1 });
        return (
          <OutlineItemRow
            key={pt.id}
            icon={<MapPin size={12} />}
            label={name}
            active={activeId === pt.id}
            onSelect={() => openPoi(pt.id)}
            onRemove={() => usePlanPoiStore.getState().removePoint(pt.id)}
            removeLabel={t("deleteItem", { name })}
          />
        );
      })}
    </OutlineGroup>
  );
}
