"use client";

/**
 * @module MissionPlannerPage
 * @description Top-level page component for the mission planner view.
 * Pure layout -- all logic lives in {@link usePlanner} and {@link useKeyboardShortcuts}.
 *
 * Two states. With no plan open, the plan library docks at the left of a
 * full-bleed map and is the way in. With a plan open, the planner bar runs
 * across the top, the plan outline and the inspector sit either side of the
 * map, the tool rail floats over it and the dock runs along its bottom; the
 * library is then a sheet over the map's left edge (Plans button, Ctrl/Cmd+O).
 * @license GPL-3.0-only
 */

import { useCallback, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MapToolbar } from "@/components/planner/MapToolbar";
import { CoordinateWidget } from "@/components/planner/CoordinateWidget";
import { PlaceSearchBox, FOCUS_PLACE_SEARCH_EVENT } from "@/components/planner/PlaceSearchBox";
import { MapContextMenu } from "@/components/planner/MapContextMenu";
import { OverlayPanel } from "@/components/planner/OverlayPanel";
import { DownloadAreaPanel } from "@/components/planner/DownloadAreaPanel";
import { PlanOutline } from "@/components/planner/outline/PlanOutline";
import { PlannerInspector } from "@/components/planner/inspector/PlannerInspector";
import { PlannerDock, DOCK_STRIP_HEIGHT, DOCK_DRAWER_HEIGHT } from "@/components/planner/dock/PlannerDock";
import { SendToVehicleDialog } from "@/components/planner/SendToVehicleDialog";
import { FlightPlanLibrary } from "@/components/library/FlightPlanLibrary";
import { UnsavedChangesDialog } from "@/components/library/UnsavedChangesDialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SidePanel } from "@/components/ui/side-panel";
import { useDroneManager } from "@/stores/drone-manager";
import { usePlannerStore, type DockTab } from "@/stores/planner-store";
import { useMissionStore } from "@/stores/mission-store";
import { readPlanFromHash } from "@/lib/plan-share";
import { restoreSharedPlanExtras } from "@/lib/plan-workspace";
import { useSettingsStore } from "@/stores/settings-store";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { registerCommandProvider } from "@/lib/command-palette-registry";
import { setClipboard, getClipboard } from "@/lib/waypoint-clipboard";
import { randomId } from "@/lib/utils";
import { MAP_OVERLAY_Z } from "@/lib/map-overlay-z";
import { startGroundElevationSync } from "@/lib/mission/sample-ground-elevations";
import { usePlanner } from "./use-planner";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";
import { buildPlannerCommands, type PlannerCommandHandlers } from "./planner-commands";
import { PlannerBar } from "./PlannerBar";
import { usePlannerShareImport } from "./use-planner-share-import";

const PlannerMap = dynamic(() => import("@/components/planner/PlannerMap").then((m) => m.PlannerMap), { ssr: false });

/** The library's own search-focus event (see FlightPlanLibrary's search bar). */
const FOCUS_LIBRARY_SEARCH_EVENT = "plan-library:focus-search";

/** Gap kept between the dock and the bottom-right coordinate readout. */
const DOCK_GAP = 8;

export default function MissionPlannerPage() {
  const t = useTranslations("planner");
  const router = useRouter();
  const p = usePlanner();
  const droneCount = useDroneManager((s) => s.drones.size);
  const hasDrone = droneCount > 0;
  const hasActivePlan = !!p.activePlanId;
  const isDownloading = p.downloadState === "downloading";
  const { supports } = useFirmwareCapabilities();
  const showGeofence = !hasDrone || supports("supportsGeoFence");
  const showRally = !hasDrone || supports("supportsRally");

  const outlineOpen = usePlannerStore((s) => s.outlineOpen);
  const inspectorOpen = usePlannerStore((s) => s.inspectorOpen);
  const dockOpen = usePlannerStore((s) => s.dockOpen);
  const librarySheetOpen = usePlannerStore((s) => s.librarySheetOpen);
  const inspectorIsMission = usePlannerStore((s) => s.inspectorTarget.kind === "mission");
  const selectedCount = usePlannerStore((s) => s.selectedWaypointIds.length);
  const mapBounds = usePlannerStore((s) => s.mapBounds);
  const mapZoom = usePlannerStore((s) => s.mapZoom);
  const mapTileSource = useSettingsStore((s) => s.mapTileSource);
  const shareIo = usePlannerShareImport(p);

  const [overlayPanelOpen, setOverlayPanelOpen] = useState(false);
  const [downloadPanelOpen, setDownloadPanelOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  // Panel toggles from the keyboard snap; from the pointer they slide. The flag
  // is false only for the render that applies a keyboard toggle.
  const [panelAnimate, setPanelAnimate] = useState(true);

  // The overlay and download panels dock at the same spot, so they are mutually
  // exclusive — opening one closes the other.
  const toggleOverlayPanel = useCallback(() => {
    setOverlayPanelOpen((v) => !v);
    setDownloadPanelOpen(false);
  }, []);
  const toggleDownloadPanel = useCallback(() => {
    setDownloadPanelOpen((v) => !v);
    setOverlayPanelOpen(false);
  }, []);
  // Keep every waypoint's terrain sample matched to its position while the
  // planner is open: any edit that moves a waypoint drops its old sample, and
  // the sync looks up the ground under the new spot.
  useEffect(() => startGroundElevationSync(), []);

  // Load a shared plan from the URL fragment (#plan=...) on first mount. Non-destructive:
  // it only applies when the current mission is empty, so a share link can never clobber
  // in-progress work. The fragment is then cleared so a refresh does not reload it.
  useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash) return;
    const shared = readPlanFromHash(window.location.hash);
    if (shared) {
      const ms = useMissionStore.getState();
      if (ms.waypoints.length === 0) {
        ms.setWaypoints(shared.waypoints);
        p.setMissionName(shared.metadata.name);
        restoreSharedPlanExtras(shared);
      }
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opening, creating or closing a plan always dismisses the library sheet and
  // returns the inspector to that plan's mission settings.
  useEffect(() => {
    const s = usePlannerStore.getState();
    s.setLibrarySheetOpen(false);
    s.setInspectorTarget({ kind: "mission" });
    s.clearSelection();
  }, [p.activePlanId]);

  // Esc closes the sheet before any planner Escape handling sees the key.
  useEffect(() => {
    if (!librarySheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      usePlannerStore.getState().setLibrarySheetOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [librarySheetOpen]);

  const togglePattern = useCallback(() => {
    const s = usePlannerStore.getState();
    s.setInspectorTarget(s.inspectorTarget.kind === "pattern" ? { kind: "mission" } : { kind: "pattern" });
    if (!s.inspectorOpen) s.toggleInspector();
  }, []);
  const openDock = useCallback((tab: DockTab) => usePlannerStore.getState().setDock(tab, true), []);
  const toggleAltitude = useCallback(() => usePlannerStore.getState().setDock("altitude"), []);
  const toggleIssues = useCallback(() => usePlannerStore.getState().setDock("issues"), []);
  const togglePlans = useCallback(() => {
    const s = usePlannerStore.getState();
    const opening = !hasActivePlan || !s.librarySheetOpen;
    if (hasActivePlan) s.setLibrarySheetOpen(opening);
    if (opening) requestAnimationFrame(() => document.dispatchEvent(new CustomEvent(FOCUS_LIBRARY_SEARCH_EVENT)));
  }, [hasActivePlan]);
  const transformMission = useCallback(() => {
    const s = usePlannerStore.getState();
    s.setInspectorTarget({ kind: "transform" });
    if (!s.inspectorOpen) s.toggleInspector();
  }, []);
  const simulate = useCallback(() => router.push("/simulate"), [router]);
  const openSend = useCallback(() => setSendOpen(true), []);
  const keyboardToggle = useCallback((toggle: () => void) => () => {
    setPanelAnimate(false);
    toggle();
    requestAnimationFrame(() => requestAnimationFrame(() => setPanelAnimate(true)));
  }, []);
  const { toggleOutline, toggleInspector, togglePanels, clearSelection } = usePlannerStore.getState();

  useKeyboardShortcuts({
    activeTool: p.activeTool, setActiveTool: p.setActiveTool, undo: p.undo, redo: p.redo,
    selectedWaypointId: p.selectedWaypointId, removeWaypoint: p.removeWaypoint, setSelectedWaypoint: p.setSelectedWaypoint,
    selectedCount, clearSelection, inspectorIsMission,
    resetInspector: () => usePlannerStore.getState().setInspectorTarget({ kind: "mission" }),
    handleSave: p.handleSave, handleSaveAs: p.handleSaveAs, handleNewPlan: p.handleNewPlan,
    onTogglePlans: togglePlans,
    onToggleOutline: keyboardToggle(toggleOutline),
    onToggleInspector: keyboardToggle(toggleInspector),
    onTogglePanels: keyboardToggle(togglePanels),
    onToggleTerrain: toggleAltitude, onTogglePatternEditor: togglePattern, onToggleValidation: toggleIssues,
    onToggleOverlays: toggleOverlayPanel,
    onFocusPlaceSearch: () => document.dispatchEvent(new CustomEvent(FOCUS_PLACE_SEARCH_EVENT)),
    onNudgeSelected: (dLat, dLon) => {
      if (!p.selectedWaypointId) return;
      const wp = p.waypoints.find((w) => w.id === p.selectedWaypointId);
      if (wp) p.updateWaypoint(p.selectedWaypointId, { lat: wp.lat + dLat, lon: wp.lon + dLon });
    },
    onCopy: () => {
      if (!p.selectedWaypointId) return;
      const wp = p.waypoints.find((w) => w.id === p.selectedWaypointId);
      if (wp) setClipboard([wp]);
    },
    onPaste: () => {
      const clip = getClipboard();
      if (clip.length === 0) return;
      // Paste copies slightly offset so they are visible and selectable. The
      // copy sits over different ground, so the original's terrain sample is
      // dropped and resampled.
      const pasted = clip.map(({ groundElevation: _moved, ...wp }) => ({
        ...wp, id: randomId(), lat: wp.lat + 0.0002, lon: wp.lon + 0.0002,
      }));
      const ms = useMissionStore.getState();
      ms.setWaypoints([...ms.waypoints, ...pasted]);
    },
  });

  // Contribute planner verbs to the ⌘K command palette while this page is
  // mounted. The provider closes over the current handlers and re-registers if
  // any change (the planner handlers are memoized, so this normally runs once).
  const {
    setActiveTool: pSetActiveTool, undo: pUndo, redo: pRedo,
    handleSave: pHandleSave, handleSaveAs: pHandleSaveAs, handleNewPlan: pHandleNewPlan,
    handleDownloadFromDrone, handleExportNative, handleExportWaypoints, handleExportPlan,
    handleExportKML, handleExportKMZ, handleExportCSV, handleReverseWaypoints, handleClearAll,
  } = p;
  const { handleImportBoundary, handleExportBrief, handleCopyShareLink } = shareIo;
  useEffect(() => {
    const handlers: PlannerCommandHandlers = {
      setActiveTool: pSetActiveTool, undo: pUndo, redo: pRedo,
      handleSave: pHandleSave, handleSaveAs: pHandleSaveAs, handleNewPlan: pHandleNewPlan,
      toggleTerrain: toggleAltitude, togglePattern, toggleValidation: toggleIssues, toggleOverlays: toggleOverlayPanel,
      togglePlans, toggleOutline, toggleInspector, togglePanels, openDock,
      sendToVehicle: openSend,
      downloadFromDrone: handleDownloadFromDrone, importBoundary: handleImportBoundary,
      exportNative: handleExportNative, exportWaypoints: handleExportWaypoints, exportPlan: handleExportPlan,
      exportKML: handleExportKML, exportKMZ: handleExportKMZ, exportCSV: handleExportCSV,
      exportBrief: handleExportBrief, copyShareLink: () => { void handleCopyShareLink(); },
      reverseWaypoints: handleReverseWaypoints, transformMission, simulate, discardPlan: handleClearAll,
    };
    const category = t("paletteCategory");
    return registerCommandProvider((ctx) =>
      ctx.pathname.startsWith("/plan") ? buildPlannerCommands(handlers, (k) => t(k), category, ctx.query) : [],
    );
  }, [
    pSetActiveTool, pUndo, pRedo, pHandleSave, pHandleSaveAs, pHandleNewPlan, toggleAltitude, togglePattern,
    toggleIssues, toggleOverlayPanel, togglePlans, toggleOutline, toggleInspector, togglePanels, openDock, openSend,
    handleDownloadFromDrone, handleImportBoundary, handleExportNative, handleExportWaypoints, handleExportPlan,
    handleExportKML, handleExportKMZ, handleExportCSV, handleExportBrief, handleCopyShareLink,
    handleReverseWaypoints, transformMission, simulate, handleClearAll, t,
  ]);

  const library = (presentation: "panel" | "sheet") => (
    <FlightPlanLibrary context="plan" presentation={presentation}
      onClose={() => usePlannerStore.getState().setLibrarySheetOpen(false)}
      onPlanLoaded={p.handlePlanLoaded} onSave={p.handleSave}
      onPlanRenamed={p.handlePlanRenamed} onDownloadFromDrone={p.handleDownloadFromDrone}
      isDownloading={isDownloading} hasDrone={hasDrone} />
  );
  const coordinateLift = DOCK_STRIP_HEIGHT + (dockOpen ? DOCK_DRAWER_HEIGHT : 0) + DOCK_GAP;

  return (
    <>
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {hasActivePlan && <PlannerBar p={p} hasDrone={hasDrone} shareIo={shareIo} onOpenSend={openSend} />}
        <div className="flex-1 flex overflow-hidden">
          {hasActivePlan ? (
            <SidePanel side="left" open={outlineOpen} width={264} animate={panelAnimate} ariaLabel={t("outline.label")}>
              <PlanOutline p={p} showGeofence={showGeofence} showRally={showRally} />
            </SidePanel>
          ) : (
            library("panel")
          )}

          <div className="flex-1 relative min-w-0">
            <div className="absolute inset-x-0 top-0" style={{ bottom: hasActivePlan ? DOCK_STRIP_HEIGHT : 0 }}>
              <PlannerMap waypoints={p.waypoints} activeTool={p.activeTool} selectedWaypointId={p.selectedWaypointId}
                hasActivePlan={hasActivePlan} rallyPoints={p.rallyPoints} onMapClick={p.handleMapClick}
                onMapRightClick={p.handleMapRightClick} onWaypointClick={p.handleWaypointClick}
                onWaypointDragEnd={p.handleWaypointDragEnd} onWaypointRightClick={p.handleWaypointRightClick}
                onDrawingComplete={p.handleDrawingComplete} />
            </div>
            {hasActivePlan && (
              <>
                <PlaceSearchBox />
                <CoordinateWidget bottomOffset={coordinateLift} />
                <MapToolbar activeTool={p.activeTool} onToolChange={p.setActiveTool}
                  canUndo={p.canUndo} canRedo={p.canRedo} onUndo={p.undo} onRedo={p.redo}
                  onToggleOverlays={toggleOverlayPanel} overlayPanelOpen={overlayPanelOpen}
                  onToggleDownload={toggleDownloadPanel} downloadPanelOpen={downloadPanelOpen} downloadDisabled={!mapBounds} />
                {overlayPanelOpen && <OverlayPanel onClose={() => setOverlayPanelOpen(false)} />}
                {downloadPanelOpen && mapBounds && (
                  <DownloadAreaPanel bounds={mapBounds} currentZoom={mapZoom} currentProvider={mapTileSource}
                    onClose={() => setDownloadPanelOpen(false)} />
                )}
                <PlannerDock p={p} />
                {librarySheetOpen && (
                  <div className="absolute left-0 top-0 bottom-0 flex" style={{ zIndex: MAP_OVERLAY_Z.popover }}>
                    {library("sheet")}
                  </div>
                )}
              </>
            )}
          </div>

          {hasActivePlan && (
            <SidePanel side="right" open={inspectorOpen} width={300} animate={panelAnimate} ariaLabel={t("inspector.label")}>
              <PlannerInspector p={p} showGeofence={showGeofence} showRally={showRally} />
            </SidePanel>
          )}
          {p.contextMenu && (
            <MapContextMenu x={p.contextMenu.x} y={p.contextMenu.y} items={p.contextMenu.items}
              onSelect={p.handleContextAction} onClose={() => p.setContextMenu(null)} />
          )}
        </div>
      </div>

      {shareIo.boundaryInput}
      <SendToVehicleDialog open={sendOpen} onClose={() => setSendOpen(false)} p={p}
        showGeofence={showGeofence} showRally={showRally} />
      <ConfirmDialog open={p.showClearConfirm} onConfirm={p.confirmClear} onCancel={() => p.setShowClearConfirm(false)}
        title={t("discardChanges")} message={t("discardChangesBody")}
        confirmLabel={t("discard")} variant="danger" />
      <ConfirmDialog open={p.showPatternApplyConfirm} onConfirm={p.applyPatternConfirmed}
        onCancel={() => p.setShowPatternApplyConfirm(false)}
        title={t("applyConfirmTitle")} message={t("applyConfirmBody")}
        confirmLabel={t("applyConfirmButton")} variant="danger" />
      <UnsavedChangesDialog open={p.showDownloadConfirm} onSaveAndSwitch={p.handleSaveAndDownload}
        onDiscardAndSwitch={p.handleDiscardAndDownload} onCancel={p.handleCancelDownload} />
    </>
  );
}
