/**
 * @module use-planner-actions
 * @description Map handlers and toolbar actions for the mission planner.
 * @license GPL-3.0-only
 */

import { useCallback } from "react";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useMissionStore } from "@/stores/mission-store";
import { usePatternStore } from "@/stores/pattern-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { randomId } from "@/lib/utils";
import { acceptRadiusDefault } from "@/components/planner/waypoint-constants";
import { clearAutoSave } from "@/lib/mission-io";
import { useDrawingStore } from "@/stores/drawing-store";
import { useRallyStore } from "@/stores/rally-store";
import { withPlannerHistory } from "@/lib/planner-history";
import { clampLat, clampLon, clampAlt } from "./use-planner-state";
import type { ContextMenuState } from "./use-planner-state";
import type { Waypoint } from "@/lib/types";
import { patternToMission } from "@/lib/patterns/pattern-to-mission";
import type { DrawnPolygon, DrawnCircle } from "@/lib/drawing/types";
import type { DrawingFor } from "@/lib/planner-mode";
import { datumPatternFor } from "@/lib/planner-mode";

interface ActionsDeps {
  waypoints: Waypoint[];
  activePlanId: string | null;
  isDirty: boolean;
  activeTool: string;
  defaultAlt: number;
  defaultSpeed: number;
  defaultAcceptRadius: number;
  selectedDroneId: string;
  missionName: string;
  contextMenu: ContextMenuState | null;
  // Store actions
  addWaypoint: (wp: Waypoint) => void;
  removeWaypoint: (id: string) => void;
  insertWaypoint: (wp: Waypoint, index: number) => void;
  clearMission: () => void;
  setWaypoints: (wps: Waypoint[]) => void;
  downloadMission: () => Promise<Waypoint[]>;
  uploadMission: () => Promise<boolean>;
  addRallyPoint: (point: { id: string; lat: number; lon: number; alt: number }) => void;
  // State setters
  setContextMenu: (menu: ContextMenuState | null) => void;
  setSelectedWaypoint: (id: string | null) => void;
  setShowClearConfirm: (show: boolean) => void;
  // Optional so the composition layer (use-planner.ts, not owned by this file)
  // can wire it in a follow-up without a compile break; the pattern-apply gate
  // no-ops safely (no destructive apply) until it is provided.
  setShowPatternApplyConfirm?: (show: boolean) => void;
  setShowDownloadConfirm: (show: boolean) => void;
  setMissionName: (name: string) => void;
  setSelectedDroneId: (id: string) => void;
  toast: (message: string, status?: "success" | "warning" | "error" | "info") => void;
}

/**
 * Map toolbar tool -> the NAVIGATION command it places. `roi` is deliberately
 * absent: ROI is an action, not a navigation command, so placing it as its own
 * top-level row produced a mission the validator rejects (`ACTION_AS_NAV`) and
 * the FC mis-sequences. The ROI tool attaches an action to the nearest
 * waypoint instead — see `attachRoiAction`.
 */
const TOOL_COMMAND_MAP: Record<string, Waypoint["command"]> = {
  select: "WAYPOINT",
  waypoint: "WAYPOINT",
  takeoff: "TAKEOFF",
  land: "LAND",
  // A timed loiter: the operator sets the hold. An unlimited LOITER never
  // advances on its own, so it is never placed by a click.
  loiter: "LOITER_TIME",
};

/**
 * The frame a newly placed waypoint is stamped with: the planner default at the
 * moment of placement. Stored on the waypoint so a later change of the default
 * never changes what this altitude means.
 */
const placementFrame = () => usePlannerStore.getState().defaultFrame;

/**
 * Attach an ROI action to a navigation waypoint. ROI is a non-navigation
 * command: on the wire it is a mission item sequenced after the waypoint it
 * fires at, so it must ride in that waypoint's `actions[]`. Returns false when
 * there is no waypoint to attach to.
 */
function attachRoiAction(
  waypoints: readonly Waypoint[],
  lat: number,
  lon: number,
  alt: number,
): boolean {
  const parent = waypoints[waypoints.length - 1];
  if (!parent) return false;
  useMissionStore.getState().updateWaypoint(parent.id, {
    actions: [
      ...(parent.actions ?? []),
      { id: randomId(), command: "ROI", lat, lon, alt },
    ],
  });
  return true;
}

export function usePlannerActions(deps: ActionsDeps) {
  const {
    waypoints, activePlanId, isDirty, activeTool, defaultAlt, defaultSpeed, defaultAcceptRadius,
    selectedDroneId, missionName, contextMenu,
    addWaypoint, removeWaypoint, insertWaypoint, clearMission, setWaypoints,
    downloadMission, uploadMission,
    addRallyPoint, setContextMenu, setSelectedWaypoint,
    setShowClearConfirm, setShowPatternApplyConfirm, setShowDownloadConfirm,
    setMissionName, setSelectedDroneId,
    toast,
  } = deps;

  const handleMapClick = useCallback(
    (lat: number, lon: number) => {
      if (activeTool === "rally") {
        // Sticky: keep placing rally points until the tool is switched.
        addRallyPoint({ id: randomId(), lat: clampLat(lat), lon: clampLon(lon), alt: clampAlt(defaultAlt) });
        toast("Rally point placed", "success");
        return;
      }
      // SAR pattern datum/start point placement — explicit "datum" tool only, so a
      // plain select-mode click can never silently move the datum. The armed
      // pattern is read from the authoritative planner mode (set when datum was
      // armed), not from a sibling store. Sticky: stays in datum mode so the point
      // can be re-placed; switch tools to exit.
      if (activeTool === "datum") {
        const mode = usePlannerStore.getState().mode;
        const pattern = mode.kind === "datum" ? datumPatternFor(mode) : null;
        const patternStore = usePatternStore.getState();
        if (pattern === "expandingSquare") {
          patternStore.updateSarExpandingSquareConfig({ center: [clampLat(lat), clampLon(lon)] });
          toast("Datum point set", "success");
        } else if (pattern === "sectorSearch") {
          patternStore.updateSarSectorSearchConfig({ center: [clampLat(lat), clampLon(lon)] });
          toast("Datum point set", "success");
        } else if (pattern === "parallelTrack") {
          patternStore.updateSarParallelTrackConfig({ startPoint: [clampLat(lat), clampLon(lon)] });
          toast("Start point set", "success");
        } else {
          // survey / orbit / corridor / structureScan take their area from a
          // drawn boundary, not a datum click — don't claim no pattern is armed.
          toast("This pattern's area is set by drawing", "info");
        }
        return;
      }
      // The ROI tool attaches an action to the last navigation waypoint rather
      // than creating a top-level ROI row, which is not a navigation command.
      if (activeTool === "roi") {
        if (!activePlanId) { toast("Create or select a flight plan first", "info"); return; }
        const attached = attachRoiAction(waypoints, clampLat(lat), clampLon(lon), clampAlt(defaultAlt));
        toast(
          attached ? "ROI attached to the last waypoint" : "Add a waypoint before setting an ROI",
          attached ? "success" : "info",
        );
        return;
      }
      const command = TOOL_COMMAND_MAP[activeTool];
      if (!command) return;
      if (!activePlanId) { toast("Create or select a flight plan first", "info"); return; }
      const wp: Waypoint = {
        id: randomId(), lat: clampLat(lat), lon: clampLon(lon),
        alt: command === "LAND" ? 0 : clampAlt(defaultAlt), speed: defaultSpeed, command,
        frame: placementFrame(),
        ...acceptRadiusDefault(command, defaultAcceptRadius),
      };
      addWaypoint(wp);
    },
    [activePlanId, activeTool, addWaypoint, addRallyPoint, defaultAlt, defaultSpeed, defaultAcceptRadius, toast, waypoints]
  );

  const handleMapRightClick = useCallback(
    (lat: number, lon: number, x: number, y: number) => {
      setContextMenu({
        x, y, lat, lon,
        items: [
          { id: "add-wp", label: "Add Waypoint" },
          { id: "add-takeoff", label: "Add Takeoff" },
          { id: "add-land", label: "Add Land" },
          { id: "add-roi", label: "Set ROI" },
          { id: "div1", label: "", divider: true },
          { id: "add-rally", label: "Add Rally Point Here" },
          { id: "div2", label: "", divider: true },
          { id: "center", label: "Center Map Here" },
        ],
      });
    },
    [setContextMenu]
  );

  const handleWaypointRightClick = useCallback(
    (id: string, x: number, y: number) => {
      setContextMenu({
        x, y, waypointId: id,
        items: [
          { id: "edit", label: "Edit" },
          { id: "insert-before", label: "Insert Before" },
          { id: "insert-after", label: "Insert After" },
          { id: "div1", label: "", divider: true },
          { id: "delete-wp", label: "Delete", danger: true },
        ],
      });
    },
    [setContextMenu]
  );

  // Insert a fresh waypoint just before or after an existing one, nudged off
  // it so the two markers don't stack. Shared by the map context menu and the
  // waypoint inspector's menu.
  const handleInsertRelative = useCallback(
    (waypointId: string, where: "before" | "after") => {
      const idx = waypoints.findIndex((w) => w.id === waypointId);
      if (idx === -1) return;
      const ref = waypoints[idx];
      const newWp: Waypoint = {
        id: randomId(), lat: clampLat(ref.lat + 0.0005), lon: clampLon(ref.lon + 0.0005),
        alt: clampAlt(defaultAlt), command: "WAYPOINT", frame: placementFrame(),
        ...acceptRadiusDefault("WAYPOINT", defaultAcceptRadius),
      };
      insertWaypoint(newWp, where === "before" ? idx : idx + 1);
    },
    [waypoints, defaultAlt, defaultAcceptRadius, insertWaypoint]
  );

  const handleContextAction = useCallback(
    (actionId: string) => {
      if (!contextMenu) return;
      const { lat, lon, waypointId } = contextMenu;
      const addActions = ["add-wp", "add-takeoff", "add-land", "add-roi"];
      if (addActions.includes(actionId) && !activePlanId) {
        toast("Create or select a flight plan first", "info");
        setContextMenu(null);
        return;
      }
      const makeWp = (cmd: Waypoint["command"]): Waypoint => ({
        id: randomId(), lat: clampLat(lat ?? 0), lon: clampLon(lon ?? 0),
        alt: cmd === "LAND" ? 0 : clampAlt(defaultAlt), command: cmd, frame: placementFrame(),
        ...acceptRadiusDefault(cmd ?? "WAYPOINT", defaultAcceptRadius),
      });
      switch (actionId) {
        case "add-wp": addWaypoint(makeWp("WAYPOINT")); break;
        case "add-takeoff": addWaypoint(makeWp("TAKEOFF")); break;
        case "add-land": addWaypoint(makeWp("LAND")); break;
        // ROI is an action, not a navigation command: it attaches to the last
        // waypoint instead of becoming a top-level row the FC mis-sequences.
        case "add-roi": {
          const attached = attachRoiAction(
            waypoints, clampLat(lat ?? 0), clampLon(lon ?? 0), clampAlt(defaultAlt),
          );
          if (!attached) toast("Add a waypoint before setting an ROI", "info");
          break;
        }
        case "add-rally":
          addRallyPoint({ id: randomId(), lat: clampLat(lat ?? 0), lon: clampLon(lon ?? 0), alt: clampAlt(defaultAlt) });
          break;
        case "center":
          if (lat !== undefined && lon !== undefined) {
            usePlannerStore.getState().requestPan(lat, lon);
          }
          break;
        case "edit":
          if (waypointId) setSelectedWaypoint(waypointId);
          break;
        case "insert-before":
          if (waypointId) handleInsertRelative(waypointId, "before");
          break;
        case "insert-after":
          if (waypointId) handleInsertRelative(waypointId, "after");
          break;
        case "delete-wp": if (waypointId) removeWaypoint(waypointId); break;
      }
      setContextMenu(null);
    },
    [contextMenu, activePlanId, addWaypoint, addRallyPoint, removeWaypoint, defaultAlt, defaultAcceptRadius, waypoints, setSelectedWaypoint, toast, setContextMenu, handleInsertRelative]
  );

  const handleWaypointClick = useCallback((id: string, additive?: boolean, range?: boolean) => {
    const planner = usePlannerStore.getState();
    if (range && planner.selectedWaypointId) {
      planner.selectRange(planner.selectedWaypointId, id, waypoints.map((w) => w.id));
    } else if (additive) {
      // The first Ctrl/Cmd+click after a plain selection carries that waypoint
      // into the batch, so two clicks make a two-waypoint batch.
      const anchor = planner.selectedWaypointId;
      if (planner.selectedWaypointIds.length === 0 && anchor && anchor !== id) {
        planner.toggleWaypointSelection(anchor);
      }
      planner.toggleWaypointSelection(id);
    } else {
      // A plain click starts over: one waypoint, no batch.
      planner.clearMultiSelection();
      setSelectedWaypoint(id);
    }
  }, [setSelectedWaypoint, waypoints]);

  // Insert a waypoint between waypoint index-1 and index. Position is the midpoint
  // of its two neighbours, altitude their average, and it inherits the preceding
  // waypoint's frame + speed. When inserting past the last row (no following
  // waypoint) the new point is nudged off the previous one.
  const handleInsertAt = useCallback((index: number) => {
    const wps = useMissionStore.getState().waypoints;
    const before = wps[index - 1];
    if (!before) return;
    const after = wps[index];
    const newWp: Waypoint = {
      id: randomId(),
      lat: after ? (before.lat + after.lat) / 2 : before.lat + 0.0005,
      lon: after ? (before.lon + after.lon) / 2 : before.lon + 0.0005,
      alt: after ? (before.alt + after.alt) / 2 : before.alt,
      speed: before.speed,
      frame: before.frame ?? usePlannerStore.getState().defaultFrame,
      command: "WAYPOINT",
      ...acceptRadiusDefault("WAYPOINT", usePlannerStore.getState().defaultAcceptRadius),
    };
    useMissionStore.getState().insertWaypoint(newWp, index);
  }, []);

  const handleWaypointDragEnd = useCallback(
    (id: string, lat: number, lon: number) => {
      // The store drops the moved waypoint's old terrain sample; the terrain
      // sync resamples the new position.
      setWaypoints(waypoints.map((wp) => wp.id === id ? { ...wp, lat: clampLat(lat), lon: clampLon(lon) } : wp));
    },
    [waypoints, setWaypoints]
  );

  const handleClearAll = useCallback(() => {
    // "Clear All" clears every planner domain, so open the confirm whenever ANY
    // of them has content — not only when there are waypoints.
    const geo = useGeofenceStore.getState();
    const draw = useDrawingStore.getState();
    const hasContent =
      waypoints.length > 0 ||
      useRallyStore.getState().points.length > 0 ||
      draw.polygons.length > 0 || draw.circles.length > 0 || draw.measureLine !== null ||
      geo.enabled || geo.polygonPoints.length > 0 || geo.circleCenter !== null || geo.zones.length > 0;
    if (hasContent) setShowClearConfirm(true);
  }, [waypoints.length, setShowClearConfirm]);

  const confirmClear = useCallback(() => {
    // One undo step restores every domain "Clear All" wiped.
    withPlannerHistory(() => {
      clearMission();
      useRallyStore.getState().clearPoints();
      useDrawingStore.getState().clearAll();
      useGeofenceStore.getState().clearFence();
    });
    void clearAutoSave();
    usePlannerStore.getState().clearSelection();
    setMissionName("");
    setSelectedDroneId("");
    setShowClearConfirm(false);
    toast("Mission cleared", "info");
  }, [clearMission, toast, setMissionName, setSelectedDroneId, setShowClearConfirm]);

  const handleReverseWaypoints = useCallback(() => {
    if (waypoints.length < 2) return;
    setWaypoints([...waypoints].reverse());
    toast("Waypoints reversed", "info");
  }, [waypoints, setWaypoints, toast]);

  /** Upload the mission. Toasts the outcome and returns it for callers that report it inline. */
  const handleUpload = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    const ok = await uploadMission();
    if (ok) { toast("Mission uploaded to FC", "success"); return { success: true, message: "Mission uploaded to FC" }; }
    const reason = useMissionStore.getState().uploadError;
    const message = reason ? `Mission upload failed: ${reason}` : "Mission upload failed";
    toast(message, "error");
    return { success: false, message };
  }, [uploadMission, toast]);

  const handleDrawingComplete = useCallback(
    (shape: DrawnPolygon | DrawnCircle) => {
      const patternStore = usePatternStore.getState();
      const patternType = patternStore.activePatternType;
      const geoStore = useGeofenceStore.getState();
      const drawingStore = useDrawingStore.getState();

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

      if ("vertices" in shape) {
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
          toast(`Geofence polygon set (${shape.vertices.length} vertices)`, "success");
        } else if (routeToPattern && patternType === "survey") {
          patternStore.updateSurveyConfig({ polygon: shape.vertices });
          usePlannerStore.getState().setInspectorTarget({ kind: "pattern" });
          // The boundary now renders from the pattern config; drop the raw drawn
          // polygon so the ring is not painted twice.
          drawingStore.removePolygon(shape.id);
          toast(`Survey area set (${shape.vertices.length} vertices)`, "success");
        } else if (routeToPattern && patternType === "structureScan") {
          patternStore.updateStructureScanConfig({ structurePolygon: shape.vertices });
          usePlannerStore.getState().setInspectorTarget({ kind: "pattern" });
          drawingStore.removePolygon(shape.id);
          toast(`Structure boundary set (${shape.vertices.length} vertices)`, "success");
        } else if (routeToPattern && patternType === "corridor") {
          patternStore.updateCorridorConfig({ pathPoints: shape.vertices });
          usePlannerStore.getState().setInspectorTarget({ kind: "pattern" });
          // The corridor renders from its centerline; drop the raw filled polygon.
          drawingStore.removePolygon(shape.id);
          toast(`Corridor path set (${shape.vertices.length} points)`, "success");
        } else {
          toast(`Polygon drawn (${shape.vertices.length} vertices)`, "success");
        }
      } else {
        if (drawingFor === "geofence") {
          geoStore.setFenceType("circle");
          geoStore.setCircle(shape.center, shape.radius);
          geoStore.setEnabled(true);
          drawingStore.removeCircle(shape.id);
          toast(`Geofence circle set (r=${Math.round(shape.radius)}m)`, "success");
        } else if (routeToPattern && patternType === "orbit") {
          patternStore.updateOrbitConfig({ center: shape.center, radius: shape.radius });
          usePlannerStore.getState().setInspectorTarget({ kind: "pattern" });
          // The orbit renders from its config circle; drop the raw drawn circle.
          drawingStore.removeCircle(shape.id);
          toast(`Orbit area set (r=${Math.round(shape.radius)}m)`, "success");
        } else {
          toast(`Circle drawn (r=${Math.round(shape.radius)}m)`, "success");
        }
      }
    },
    [toast]
  );

  // The actual replace-every-waypoint apply. Kept separate from the gate so it
  // can be invoked directly (empty mission) or after the destructive-apply
  // confirm (mission already has waypoints).
  const doPatternApply = useCallback(() => {
    const patternStore = usePatternStore.getState();
    const result = patternStore.patternResult;
    if (!result || result.waypoints.length === 0) { toast("No pattern generated yet", "info"); return; }
    if (!activePlanId) { toast("Create or select a flight plan first", "info"); return; }

    // One converter shared with the mission templates: actions fold onto the
    // navigation waypoint they follow, every waypoint carries the frame the
    // generator's altitudes are measured in (above home), and TAKEOFF / RTL
    // bookend the mission. The terrain sync samples the new waypoints.
    const newWaypoints = patternToMission(result.waypoints);
    if (newWaypoints.length === 0) { toast("Pattern produced no navigation waypoints", "warning"); return; }
    setWaypoints(newWaypoints);
    patternStore.clear();
    const stats = result.stats;
    const distStr = stats.totalDistance >= 1000 ? `${(stats.totalDistance / 1000).toFixed(1)} km` : `${Math.round(stats.totalDistance)} m`;
    const timeStr = stats.estimatedTime >= 60 ? `${Math.round(stats.estimatedTime / 60)} min` : `${Math.round(stats.estimatedTime)} sec`;
    toast(`Pattern applied: ${newWaypoints.length} waypoints, ${distStr}, ~${timeStr}`, "success");
  }, [activePlanId, setWaypoints, toast]);

  const handlePatternApply = useCallback(() => {
    // Applying a pattern REPLACES every waypoint. If the mission already has
    // waypoints, open the confirm and stop here so nothing is discarded without
    // consent; an empty mission applies straight away with no prompt.
    const patternStore = usePatternStore.getState();
    const result = patternStore.patternResult;
    if (!result || result.waypoints.length === 0) { toast("No pattern generated yet", "info"); return; }
    if (!activePlanId) { toast("Create or select a flight plan first", "info"); return; }
    if (waypoints.length > 0) { setShowPatternApplyConfirm?.(true); return; }
    doPatternApply();
  }, [waypoints.length, activePlanId, doPatternApply, setShowPatternApplyConfirm, toast]);

  const applyPatternConfirmed = useCallback(() => {
    setShowPatternApplyConfirm?.(false);
    doPatternApply();
  }, [doPatternApply, setShowPatternApplyConfirm]);

  const handleAddManualWaypoint = useCallback(() => {
    if (!activePlanId) { toast("Create or select a flight plan first", "info"); return; }
    const lastWp = waypoints[waypoints.length - 1];
    // With no waypoint to follow, the new one goes where the operator is looking.
    const [centerLat, centerLon] = usePlannerStore.getState().mapCenter;
    const wp: Waypoint = {
      id: randomId(), lat: clampLat(lastWp ? lastWp.lat + 0.001 : centerLat),
      lon: clampLon(lastWp ? lastWp.lon + 0.001 : centerLon), alt: clampAlt(defaultAlt), command: "WAYPOINT",
      frame: placementFrame(),
      ...acceptRadiusDefault("WAYPOINT", defaultAcceptRadius),
    };
    addWaypoint(wp);
  }, [activePlanId, waypoints, addWaypoint, defaultAlt, defaultAcceptRadius, toast]);

  return {
    handleMapClick, handleMapRightClick, handleWaypointRightClick,
    handleContextAction, handleWaypointClick, handleWaypointDragEnd, handleInsertAt, handleInsertRelative,
    handleClearAll, confirmClear, handleReverseWaypoints, handleUpload,
    handleDrawingComplete, handlePatternApply, applyPatternConfirmed, handleAddManualWaypoint,
  };
}
