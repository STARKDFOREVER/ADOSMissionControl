/**
 * @module PlannerInspector
 * @description The planner's right-hand, selection-driven properties panel.
 * Two or more selected waypoints show the batch editor, one shows that
 * waypoint, otherwise whatever target the outline, a shortcut or a menu item
 * last pointed it at (mission when nothing did). Every non-mission view has a
 * back arrow to the mission view.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { usePlannerStore, type InspectorTarget } from "@/stores/planner-store";
import { cn } from "@/lib/utils";
import { MissionInspector } from "./MissionInspector";
import { WaypointInspector, WaypointMenu } from "./WaypointInspector";
import { BatchInspector } from "./BatchInspector";
import { PatternInspector } from "./PatternInspector";
import { GeofenceInspector } from "./GeofenceInspector";
import { RallyInspector } from "./RallyInspector";
import { PoiInspector } from "./PoiInspector";
import { TransformInspector } from "./TransformInspector";
import type { Planner } from "@/app/plan/use-planner";

interface PlannerInspectorProps {
  p: Planner;
  showGeofence: boolean;
  showRally: boolean;
}

/** What the inspector is showing, after selection has been resolved. */
export type InspectorView =
  | { kind: "batch"; ids: string[] }
  | { kind: "waypoint"; id: string; index: number }
  | InspectorTarget;

/**
 * Resolve the view: batch beats a single waypoint, which beats the target. A
 * target the connected vehicle can't use (geofence, rally) falls back to mission.
 */
export function resolveInspectorView(
  selectedIds: string[],
  selectedId: string | null,
  waypointIds: string[],
  target: InspectorTarget,
  caps: { showGeofence: boolean; showRally: boolean },
): InspectorView {
  if (selectedIds.length >= 2) return { kind: "batch", ids: selectedIds };
  const index = selectedId ? waypointIds.indexOf(selectedId) : -1;
  if (selectedId && index !== -1) return { kind: "waypoint", id: selectedId, index };
  if (target.kind === "geofence" && !caps.showGeofence) return { kind: "mission" };
  if (target.kind === "rally" && !caps.showRally) return { kind: "mission" };
  return target;
}

export function PlannerInspector({ p, showGeofence, showRally }: PlannerInspectorProps) {
  const t = useTranslations("planner.inspector");
  const selectedIds = usePlannerStore((s) => s.selectedWaypointIds);
  const selectedId = usePlannerStore((s) => s.selectedWaypointId);
  const target = usePlannerStore((s) => s.inspectorTarget);

  const view = resolveInspectorView(
    selectedIds, selectedId, p.waypoints.map((w) => w.id), target, { showGeofence, showRally },
  );
  const waypoint = view.kind === "waypoint" ? p.waypoints[view.index] : undefined;

  const title =
    view.kind === "batch" ? t("title.batch", { count: view.ids.length })
    : view.kind === "waypoint" ? t("title.waypoint", { num: view.index + 1 })
    : t(`title.${view.kind}`);

  const backToMission = () => {
    const store = usePlannerStore.getState();
    store.clearSelection();
    store.setInspectorTarget({ kind: "mission" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-primary">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border-default px-2">
        {view.kind !== "mission" && (
          <button type="button" onClick={backToMission} aria-label={t("back")} title={t("back")}
            className="rounded-sm p-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary cursor-pointer focus-ring">
            <ArrowLeft size={14} />
          </button>
        )}
        <h2 className={cn("min-w-0 flex-1 truncate text-[13px] font-semibold text-text-primary", view.kind === "mission" && "pl-1")}>
          {title}
        </h2>
        {waypoint && <WaypointMenu p={p} waypoint={waypoint} />}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto" data-inspector-view={view.kind}>
        {view.kind === "batch" && <BatchInspector selectedIds={view.ids} />}
        {waypoint && <WaypointInspector key={waypoint.id} p={p} waypoint={waypoint} />}
        {view.kind === "mission" && <MissionInspector p={p} showGeofence={showGeofence} showRally={showRally} />}
        {view.kind === "pattern" && <PatternInspector p={p} />}
        {view.kind === "geofence" && <GeofenceInspector />}
        {view.kind === "rally" && <RallyInspector focusId={view.id} />}
        {view.kind === "poi" && <PoiInspector focusId={view.id} />}
        {view.kind === "transform" && <TransformInspector />}
      </div>
    </div>
  );
}
