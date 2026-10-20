/**
 * @module use-keyboard-shortcuts
 * @description The single, ordered keyboard dispatcher for the mission planner.
 *
 * This hook is the ONLY keyboard owner for the planner. The drawing manager no
 * longer registers its own document listeners; instead this dispatcher reaches
 * the active draw through {@link getActiveDrawApi} and calls its imperative
 * methods. Having one ordered owner removes the old race where a planner hook and
 * the drawing manager both listened on `document` and fought over Escape /
 * Backspace.
 *
 * Precedence is deliberate and fixed:
 *   1. Typing-target guard — never hijack a key while the user types in a field.
 *      A key another handler already consumed (`defaultPrevented`, e.g. an open
 *      popover's capture-phase Escape) and any key while a modal
 *      (`aria-modal="true"`) is open are ignored too.
 *   2. Tool / panel letter shortcuts (no modifier), the side-panel keys `[`, `]`
 *      and `\`, plus arrow-key nudge of the selected waypoint(s). The panel and
 *      dock keys only act while a plan is open.
 *   3. Undo / redo (Cmd/Ctrl+Z), then copy / paste (Cmd/Ctrl+C / V) of the
 *      selected waypoint(s) — copy defers to a live page text selection.
 *   4. Escape — close the plans sheet first, else cancel the active draw, else
 *      clear the waypoint selection, else return the inspector to the
 *      mission, else clear any non-select tool back to select.
 *   5. Backspace / Delete — pop a draw vertex while drawing, else delete the
 *      selected waypoint(s).
 *   6. Save / Save-As (Cmd/Ctrl+S).
 *   7. Cmd/Ctrl+O toggles the plans sheet. Cmd/Ctrl+N (new plan) is desktop
 *      (Electron) only, so the browser keeps its native new-window chord.
 *
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import type { PlannerTool } from "@/lib/types";
import { isTypingTarget, isElectron } from "@/lib/utils";
import { getActiveDrawApi } from "@/lib/drawing/active-draw-api";
import { TOOL_SHORTCUT_MAP } from "@/lib/planner-shortcuts";

interface UseKeyboardShortcutsParams {
  activeTool: PlannerTool;
  setActiveTool: (tool: PlannerTool) => void;
  undo: () => void;
  redo: () => void;
  selectedWaypointId: string | null;
  removeWaypoint: (id: string) => void;
  /** Remove several waypoints in one undo step. */
  removeWaypoints: (ids: string[]) => void;
  setSelectedWaypoint: (id: string | null) => void;
  /** Waypoints in the multi-selection (Ctrl/Shift+click). */
  selectedIds: string[];
  /** Clear both the single and the multi selection. */
  clearSelection: () => void;
  /** Whether the inspector already shows the mission (its resting target). */
  inspectorIsMission: boolean;
  /** Point the inspector back at the mission. */
  resetInspector: () => void;
  /** Whether a plan is open; panel and dock keys are inert on Plans home. */
  hasActivePlan: boolean;
  /** Whether the plans sheet is open (Escape closes it first). */
  librarySheetOpen: boolean;
  onCloseLibrarySheet: () => void;
  handleSave: () => void;
  handleSaveAs?: () => void;
  handleNewPlan?: () => void;
  onTogglePlans?: () => void;
  onToggleOutline?: () => void;
  onToggleInspector?: () => void;
  onTogglePanels?: () => void;
  onTogglePatternEditor?: () => void;
  onToggleValidation?: () => void;
  onToggleTerrain?: () => void;
  onToggleOverlays?: () => void;
  onFocusPlaceSearch?: () => void;
  /**
   * Nudge the selected waypoint(s) by a small offset. An arrow key moves a fine
   * step; Shift+arrow a coarser one. dLat is positive north, dLon positive east.
   */
  onNudgeSelected?: (dLat: number, dLon: number) => void;
  /** Copy the selected waypoint(s) to the shared waypoint clipboard. */
  onCopy?: () => void;
  /** Paste the waypoint clipboard back into the plan, offset slightly. */
  onPaste?: () => void;
}

/** Fine nudge step for a plain arrow key, in degrees (~1.1 m near the equator). */
const NUDGE_STEP_FINE = 1e-5;
/** Coarser nudge step when Shift is held, in degrees. */
const NUDGE_STEP_COARSE = 1e-4;

/**
 * Tool-select letter shortcuts, derived from the single {@link PLANNER_SHORTCUTS}
 * table so the dispatched keys, the on-map help popover, and the command palette
 * can never drift apart. Each plain letter maps to exactly one tool; the
 * panel/overlay letters (T / G / I / L) below use a disjoint set.
 */
const TOOL_MAP: Readonly<Record<string, PlannerTool>> = TOOL_SHORTCUT_MAP;

/** True for the tools whose map gesture is an in-progress shape draw. */
function isDrawingTool(tool: PlannerTool): boolean {
  return tool === "polygon" || tool === "polyline" || tool === "circle" || tool === "measure";
}

/** Register the single global keyboard dispatcher for the mission planner. */
export function useKeyboardShortcuts({
  activeTool,
  setActiveTool,
  undo,
  redo,
  selectedWaypointId,
  removeWaypoint,
  removeWaypoints,
  setSelectedWaypoint,
  selectedIds,
  clearSelection,
  inspectorIsMission,
  resetInspector,
  hasActivePlan,
  librarySheetOpen,
  onCloseLibrarySheet,
  handleSave,
  handleSaveAs,
  handleNewPlan,
  onTogglePlans,
  onToggleOutline,
  onToggleInspector,
  onTogglePanels,
  onTogglePatternEditor,
  onToggleValidation,
  onToggleTerrain,
  onToggleOverlays,
  onFocusPlaceSearch,
  onNudgeSelected,
  onCopy,
  onPaste,
}: UseKeyboardShortcutsParams): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 1. Typing-target guard — a key pressed inside an input/textarea/select or
      // a contenteditable surface is never a planner shortcut.
      if (isTypingTarget(e.target)) return;
      // A key another handler already consumed, or any key while a modal
      // dialog is open (the modal owns its own keys), is not a planner shortcut.
      if (e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;

      const isMeta = e.metaKey || e.ctrlKey;
      // Chord letter independent of Shift and CapsLock: `e.key` is uppercase
      // with either held, so prefer the physical `e.code` (KeyZ -> "z").
      const chord = /^Key[A-Z]$/.test(e.code ?? "")
        ? e.code.slice(3).toLowerCase()
        : (e.key ?? "").toLowerCase();
      const draw = getActiveDrawApi();
      // The store-driven tool says a drawing tool is selected; the manager API
      // says a draw is actually in progress. Prefer the live manager state when
      // present and fall back to the tool when no manager is registered (tests,
      // SSR, transient unmount), so Backspace/Escape stay correct either way.
      const drawing = draw ? draw.isDrawing() : isDrawingTool(activeTool);

      // 2. Tool + panel letter shortcuts (no modifier).
      if (!isMeta) {
        const tool = TOOL_MAP[e.key.toLowerCase()];
        if (tool) {
          e.preventDefault();
          setActiveTool(tool);
          return;
        }

        const k = e.key.toLowerCase();
        // Panel and dock keys need an open plan; on Plans home they stay inert.
        const panelKey = k === "t" || k === "g" || k === "i" || k === "l" || e.key === "[" || e.key === "]" || e.key === "\\";
        if (panelKey && !hasActivePlan) return;

        if (k === "t") {
          e.preventDefault();
          onToggleTerrain?.();
          return;
        }
        if (k === "g") {
          e.preventDefault();
          onTogglePatternEditor?.();
          return;
        }
        if (k === "i") {
          e.preventDefault();
          onToggleValidation?.();
          return;
        }
        if (k === "l") {
          e.preventDefault();
          onToggleOverlays?.();
          return;
        }
        if (e.key === "[" || e.key === "]" || e.key === "\\") {
          e.preventDefault();
          (e.key === "[" ? onToggleOutline : e.key === "]" ? onToggleInspector : onTogglePanels)?.();
          return;
        }
        if (e.key === "/") {
          e.preventDefault();
          onFocusPlaceSearch?.();
          return;
        }

        // Arrow keys nudge the selected waypoint(s) by a small step (coarser
        // with Shift). Only handled when something is selected and the page
        // supplied a nudge handler, so an arrow with no selection keeps native
        // scrolling.
        if (onNudgeSelected && (selectedWaypointId || selectedIds.length > 0)) {
          const step = e.shiftKey ? NUDGE_STEP_COARSE : NUDGE_STEP_FINE;
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onNudgeSelected(step, 0);
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            onNudgeSelected(-step, 0);
            return;
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onNudgeSelected(0, -step);
            return;
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            onNudgeSelected(0, step);
            return;
          }
        }
      }

      // 3. Undo / redo.
      if (isMeta && chord === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (isMeta && ((chord === "z" && e.shiftKey) || (chord === "y" && !e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }

      // 3b. Copy / paste of the selected waypoint(s). Never hijack a real text
      // selection: if the user has text highlighted on the page, leave the
      // browser's native copy alone. (Typing targets are already handled above.)
      if (isMeta && chord === "c") {
        if (!onCopy) return;
        const selection = typeof window !== "undefined" ? window.getSelection?.() : null;
        if (selection && selection.toString().length > 0) return;
        e.preventDefault();
        onCopy();
        return;
      }
      if (isMeta && chord === "v") {
        if (!onPaste) return;
        e.preventDefault();
        onPaste();
        return;
      }

      // 4. Escape — the plans sheet closes first, then drawing-cancel takes
      // precedence over the generic clear.
      if (e.key === "Escape") {
        e.preventDefault();
        if (librarySheetOpen) {
          onCloseLibrarySheet();
          return;
        }
        if (drawing) {
          // Cancel the active draw via the manager, then return the tool to
          // select. The manager's onCancel callback clears the drawing store.
          draw?.cancel();
          setActiveTool("select");
          return;
        }
        if (selectedWaypointId || selectedIds.length > 0) {
          clearSelection();
        } else if (!inspectorIsMission) {
          resetInspector();
        } else if (activeTool !== "select") {
          setActiveTool("select");
        }
        return;
      }

      // 5. Backspace / Delete — vertex-pop while drawing wins over waypoint-delete.
      if (e.key === "Backspace" || e.key === "Delete") {
        if (drawing) {
          // Only Backspace pops a vertex; Delete is ignored while drawing so it
          // can never also remove a still-selected waypoint mid-draw.
          if (e.key === "Backspace") {
            e.preventDefault();
            draw?.popVertex();
          }
          return;
        }
        if (selectedIds.length >= 2) {
          e.preventDefault();
          removeWaypoints(selectedIds);
          clearSelection();
          return;
        }
        if (selectedWaypointId) {
          e.preventDefault();
          removeWaypoint(selectedWaypointId);
          setSelectedWaypoint(null);
          return;
        }
      }

      // 6. Save / Save-As.
      if (isMeta && chord === "s" && e.shiftKey) {
        e.preventDefault();
        handleSaveAs?.();
        return;
      }
      if (isMeta && chord === "s" && !e.shiftKey) {
        e.preventDefault();
        handleSave();
        return;
      }

      // 7. Cmd/Ctrl+O opens the plans sheet in the browser and the desktop app
      // alike; New stays desktop-only (the browser's new-window chord).
      if (isMeta && chord === "o") {
        if (!onTogglePlans) return;
        e.preventDefault();
        onTogglePlans();
        return;
      }
      if (isMeta && chord === "n") {
        if (!isElectron()) return;
        e.preventDefault();
        handleNewPlan?.();
        return;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    activeTool,
    setActiveTool,
    undo,
    redo,
    selectedWaypointId,
    removeWaypoint,
    removeWaypoints,
    setSelectedWaypoint,
    selectedIds,
    hasActivePlan,
    librarySheetOpen,
    onCloseLibrarySheet,
    clearSelection,
    inspectorIsMission,
    resetInspector,
    handleSave,
    handleSaveAs,
    handleNewPlan,
    onTogglePlans,
    onToggleOutline,
    onToggleInspector,
    onTogglePanels,
    onTogglePatternEditor,
    onToggleValidation,
    onToggleTerrain,
    onToggleOverlays,
    onFocusPlaceSearch,
    onNudgeSelected,
    onCopy,
    onPaste,
  ]);
}
