/**
 * Unit tests for the single planner keyboard dispatcher: typing-target guard,
 * the Escape / Backspace precedence ordering against an active draw, the side
 * panel keys, the plans-sheet chord and the Electron-only gating of New.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Control the active-draw surface the dispatcher reads.
const getActiveDrawApi = vi.fn();
vi.mock("@/lib/drawing/active-draw-api", () => ({
  getActiveDrawApi: () => getActiveDrawApi(),
}));

// Keep the real isTypingTarget, but make isElectron controllable per test.
const isElectron = vi.fn(() => false);
vi.mock("@/lib/utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils")>("@/lib/utils");
  return { ...actual, isElectron: () => isElectron() };
});

import { useKeyboardShortcuts } from "@/app/plan/use-keyboard-shortcuts";
import type { PlannerTool } from "@/lib/types";

type Params = Parameters<typeof useKeyboardShortcuts>[0];

/** Build a params object with vi.fn() spies and sensible defaults, overridable. */
function makeParams(overrides: Partial<Params> = {}): Params {
  return {
    activeTool: "select" as PlannerTool,
    setActiveTool: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    selectedWaypointId: null,
    removeWaypoint: vi.fn(),
    removeWaypoints: vi.fn(),
    setSelectedWaypoint: vi.fn(),
    selectedIds: [],
    clearSelection: vi.fn(),
    inspectorIsMission: true,
    resetInspector: vi.fn(),
    hasActivePlan: true,
    librarySheetOpen: false,
    onCloseLibrarySheet: vi.fn(),
    handleSave: vi.fn(),
    handleSaveAs: vi.fn(),
    handleNewPlan: vi.fn(),
    onTogglePlans: vi.fn(),
    onToggleOutline: vi.fn(),
    onToggleInspector: vi.fn(),
    onTogglePanels: vi.fn(),
    onTogglePatternEditor: vi.fn(),
    onToggleValidation: vi.fn(),
    onToggleTerrain: vi.fn(),
    ...overrides,
  };
}

/** Make a fake ActiveDrawApi whose isDrawing() returns the given flag. */
function drawApi(isDrawing: boolean) {
  return {
    isDrawing: () => isDrawing,
    cancel: vi.fn(),
    popVertex: vi.fn(),
    complete: vi.fn(),
  };
}

/** Dispatch a keydown on document, optionally from a typing target. */
function press(key: string, opts: KeyboardEventInit & { typing?: boolean } = {}) {
  const { typing, ...init } = opts;
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  if (typing) {
    const input = document.createElement("input");
    document.body.appendChild(input);
    Object.defineProperty(event, "target", { value: input, configurable: true });
  }
  document.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  getActiveDrawApi.mockReturnValue(null);
  isElectron.mockReturnValue(false);
  document.body.innerHTML = "";
});

describe("planner keyboard dispatcher", () => {
  it("ignores shortcuts fired from a typing target", () => {
    const params = makeParams();
    renderHook(() => useKeyboardShortcuts(params));

    press("w", { typing: true });
    press("Escape", { typing: true });
    press("Backspace", { typing: true, key: "Backspace" });

    expect(params.setActiveTool).not.toHaveBeenCalled();
  });

  it("selects a tool on its letter shortcut", () => {
    const params = makeParams();
    renderHook(() => useKeyboardShortcuts(params));
    press("w");
    expect(params.setActiveTool).toHaveBeenCalledWith("waypoint");
    press("p");
    expect(params.setActiveTool).toHaveBeenCalledWith("polygon");
  });

  it("Escape cancels an active draw before any generic clear", () => {
    const api = drawApi(true);
    getActiveDrawApi.mockReturnValue(api);
    const params = makeParams({ activeTool: "polygon", selectedWaypointId: "wp-1", inspectorIsMission: false });
    renderHook(() => useKeyboardShortcuts(params));

    press("Escape");

    expect(api.cancel).toHaveBeenCalledTimes(1);
    expect(params.setActiveTool).toHaveBeenCalledWith("select");
    // Neither the selection nor the inspector may change while a draw was cancelled.
    expect(params.clearSelection).not.toHaveBeenCalled();
    expect(params.resetInspector).not.toHaveBeenCalled();
  });

  it("Escape clears a single or multi selection first when not drawing", () => {
    const single = makeParams({ activeTool: "waypoint", selectedWaypointId: "wp-1", inspectorIsMission: false });
    const { unmount } = renderHook(() => useKeyboardShortcuts(single));
    press("Escape");
    expect(single.clearSelection).toHaveBeenCalledTimes(1);
    expect(single.resetInspector).not.toHaveBeenCalled();
    expect(single.setActiveTool).not.toHaveBeenCalled();
    unmount();

    const multi = makeParams({ selectedIds: ["a", "b", "c"] });
    renderHook(() => useKeyboardShortcuts(multi));
    press("Escape");
    expect(multi.clearSelection).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the plans sheet before anything else", () => {
    const api = drawApi(true);
    getActiveDrawApi.mockReturnValue(api);
    const params = makeParams({
      librarySheetOpen: true, activeTool: "polygon", selectedWaypointId: "wp-1", inspectorIsMission: false,
    });
    renderHook(() => useKeyboardShortcuts(params));
    press("Escape");
    expect(params.onCloseLibrarySheet).toHaveBeenCalledTimes(1);
    expect(api.cancel).not.toHaveBeenCalled();
    expect(params.setActiveTool).not.toHaveBeenCalled();
    expect(params.clearSelection).not.toHaveBeenCalled();
    expect(params.resetInspector).not.toHaveBeenCalled();
  });

  it("ignores a key another handler already consumed", () => {
    const params = makeParams({ selectedWaypointId: "wp-1" });
    renderHook(() => useKeyboardShortcuts(params));
    const consume = (e: Event) => e.preventDefault();
    document.addEventListener("keydown", consume, true);
    try {
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      document.removeEventListener("keydown", consume, true);
    }
    expect(params.clearSelection).not.toHaveBeenCalled();
  });

  it("ignores shortcuts while a modal is open", () => {
    const params = makeParams();
    renderHook(() => useKeyboardShortcuts(params));
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    press("w");
    expect(params.setActiveTool).not.toHaveBeenCalled();
  });

  it("a hidden modal kept in the DOM does not block shortcuts", () => {
    const params = makeParams();
    renderHook(() => useKeyboardShortcuts(params));
    const overlay = document.createElement("div");
    overlay.style.display = "none";
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    press("w");
    expect(params.setActiveTool).toHaveBeenCalledWith("waypoint");
  });

  it("keeps panel and tool keys inert on Plans home, and says why for a tool", () => {
    const onNoActivePlan = vi.fn();
    const params = makeParams({ hasActivePlan: false, onNoActivePlan });
    renderHook(() => useKeyboardShortcuts(params));
    const bracket = press("[");
    expect(params.onToggleOutline).not.toHaveBeenCalled();
    expect(bracket.defaultPrevented).toBe(false);
    press("t");
    expect(params.onToggleTerrain).not.toHaveBeenCalled();
    press("y");
    press("w");
    expect(params.setActiveTool).not.toHaveBeenCalled();
    expect(onNoActivePlan).toHaveBeenCalledTimes(2);
  });

  it("3 toggles the 3D view with an open plan", () => {
    const onToggleView3d = vi.fn();
    const params = makeParams({ onToggleView3d });
    renderHook(() => useKeyboardShortcuts(params));
    const event = press("3");
    expect(onToggleView3d).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("3 does nothing with no plan open", () => {
    const onToggleView3d = vi.fn();
    const params = makeParams({ hasActivePlan: false, onToggleView3d });
    renderHook(() => useKeyboardShortcuts(params));
    const event = press("3");
    expect(onToggleView3d).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("Enter finishes the active draw", () => {
    const api = drawApi(true);
    getActiveDrawApi.mockReturnValue(api);
    const params = makeParams({ activeTool: "polygon" });
    renderHook(() => useKeyboardShortcuts(params));
    const enter = press("Enter");
    expect(api.complete).toHaveBeenCalledTimes(1);
    expect(enter.defaultPrevented).toBe(true);
  });

  it("Enter does nothing when no draw is in progress", () => {
    const api = drawApi(false);
    getActiveDrawApi.mockReturnValue(api);
    renderHook(() => useKeyboardShortcuts(makeParams()));
    expect(press("Enter").defaultPrevented).toBe(false);
    expect(api.complete).not.toHaveBeenCalled();
  });

  it("Backspace deletes every selected waypoint in one batch", () => {
    const params = makeParams({ selectedWaypointId: "a", selectedIds: ["a", "b"] });
    renderHook(() => useKeyboardShortcuts(params));
    press("Backspace");
    expect(params.removeWaypoints).toHaveBeenCalledWith(["a", "b"]);
    expect(params.clearSelection).toHaveBeenCalledTimes(1);
    expect(params.removeWaypoint).not.toHaveBeenCalled();
  });

  it("arrow keys nudge a multi-selection without a single selected id", () => {
    const onNudgeSelected = vi.fn();
    const params = makeParams({ selectedIds: ["a", "b"], onNudgeSelected });
    renderHook(() => useKeyboardShortcuts(params));
    press("ArrowUp");
    expect(onNudgeSelected).toHaveBeenCalledTimes(1);
  });

  it("Escape returns the inspector to the mission before clearing the tool", () => {
    const params = makeParams({ activeTool: "waypoint", inspectorIsMission: false });
    renderHook(() => useKeyboardShortcuts(params));
    press("Escape");
    expect(params.resetInspector).toHaveBeenCalledTimes(1);
    expect(params.setActiveTool).not.toHaveBeenCalled();
  });

  it("Escape clears a non-select tool to select when nothing else is pending", () => {
    const params = makeParams({ activeTool: "waypoint" });
    renderHook(() => useKeyboardShortcuts(params));
    press("Escape");
    expect(params.setActiveTool).toHaveBeenCalledWith("select");
  });

  it("[, ] and \\ toggle the outline, the inspector and both panels", () => {
    const params = makeParams();
    renderHook(() => useKeyboardShortcuts(params));
    expect(press("[").defaultPrevented).toBe(true);
    press("]");
    press("\\");
    expect(params.onToggleOutline).toHaveBeenCalledTimes(1);
    expect(params.onToggleInspector).toHaveBeenCalledTimes(1);
    expect(params.onTogglePanels).toHaveBeenCalledTimes(1);
  });

  it("Backspace pops a draw vertex while drawing and never deletes a waypoint", () => {
    const api = drawApi(true);
    getActiveDrawApi.mockReturnValue(api);
    const params = makeParams({ activeTool: "polygon", selectedWaypointId: "wp-9" });
    renderHook(() => useKeyboardShortcuts(params));

    press("Backspace");

    expect(api.popVertex).toHaveBeenCalledTimes(1);
    expect(params.removeWaypoint).not.toHaveBeenCalled();
  });

  it("Backspace deletes the selected waypoint when not drawing", () => {
    const params = makeParams({ activeTool: "select", selectedWaypointId: "wp-9" });
    renderHook(() => useKeyboardShortcuts(params));

    press("Backspace");

    expect(params.removeWaypoint).toHaveBeenCalledWith("wp-9");
    expect(params.setSelectedWaypoint).toHaveBeenCalledWith(null);
  });

  it("Delete is ignored while drawing (only Backspace pops a vertex)", () => {
    const api = drawApi(true);
    getActiveDrawApi.mockReturnValue(api);
    const params = makeParams({ activeTool: "polygon", selectedWaypointId: "wp-9" });
    renderHook(() => useKeyboardShortcuts(params));

    press("Delete");

    expect(api.popVertex).not.toHaveBeenCalled();
    expect(params.removeWaypoint).not.toHaveBeenCalled();
  });

  it("falls back to the active tool when no draw manager is registered", () => {
    getActiveDrawApi.mockReturnValue(null);
    const params = makeParams({ activeTool: "polygon", selectedWaypointId: "wp-9" });
    renderHook(() => useKeyboardShortcuts(params));

    // No manager, but the tool is a drawing tool, so Backspace must not delete.
    press("Backspace");
    expect(params.removeWaypoint).not.toHaveBeenCalled();
  });

  describe("file chords", () => {
    it("Cmd/Ctrl+O opens the plans sheet in the browser too", () => {
      isElectron.mockReturnValue(false);
      const params = makeParams();
      renderHook(() => useKeyboardShortcuts(params));

      const openEvent = press("o", { ctrlKey: true });

      expect(params.onTogglePlans).toHaveBeenCalledTimes(1);
      expect(openEvent.defaultPrevented).toBe(true);
    });

    it("does NOT hijack Cmd/Ctrl+N in the browser", () => {
      isElectron.mockReturnValue(false);
      const params = makeParams();
      renderHook(() => useKeyboardShortcuts(params));

      const newEvent = press("n", { metaKey: true });

      expect(params.handleNewPlan).not.toHaveBeenCalled();
      expect(newEvent.defaultPrevented).toBe(false);
    });

    it("fires New in the desktop build", () => {
      isElectron.mockReturnValue(true);
      const params = makeParams();
      renderHook(() => useKeyboardShortcuts(params));

      const newEvent = press("n", { metaKey: true });

      expect(params.handleNewPlan).toHaveBeenCalledTimes(1);
      expect(newEvent.defaultPrevented).toBe(true);
    });
  });

  it("Save and Save-As fire on Cmd/Ctrl+S regardless of platform", () => {
    const params = makeParams();
    renderHook(() => useKeyboardShortcuts(params));

    press("s", { metaKey: true });
    expect(params.handleSave).toHaveBeenCalledTimes(1);

    // With Shift held on Windows/Linux the browser reports an uppercase key.
    press("S", { ctrlKey: true, shiftKey: true, code: "KeyS" });
    expect(params.handleSaveAs).toHaveBeenCalledTimes(1);
    expect(params.handleSave).toHaveBeenCalledTimes(1);
  });

  it("Save still fires under CapsLock (uppercase key, no Shift)", () => {
    const params = makeParams();
    renderHook(() => useKeyboardShortcuts(params));
    const ev = press("S", { ctrlKey: true });
    expect(params.handleSave).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  describe("undo / redo chords", () => {
    it("Ctrl+Shift+Z (uppercase key) redoes", () => {
      const params = makeParams();
      renderHook(() => useKeyboardShortcuts(params));
      press("Z", { ctrlKey: true, shiftKey: true, code: "KeyZ" });
      expect(params.redo).toHaveBeenCalledTimes(1);
      expect(params.undo).not.toHaveBeenCalled();
    });

    it("Ctrl+Y redoes", () => {
      const params = makeParams();
      renderHook(() => useKeyboardShortcuts(params));
      press("y", { ctrlKey: true, code: "KeyY" });
      expect(params.redo).toHaveBeenCalledTimes(1);
    });

    it("CapsLock Ctrl+Z undoes", () => {
      const params = makeParams();
      renderHook(() => useKeyboardShortcuts(params));
      press("Z", { ctrlKey: true });
      expect(params.undo).toHaveBeenCalledTimes(1);
      expect(params.redo).not.toHaveBeenCalled();
    });
  });

  describe("arrow-key nudge of the selected waypoint", () => {
    it("nudges the selected waypoint a fine step per direction", () => {
      const onNudgeSelected = vi.fn();
      const params = makeParams({ selectedWaypointId: "wp-1", onNudgeSelected });
      renderHook(() => useKeyboardShortcuts(params));

      const up = press("ArrowUp");
      expect(onNudgeSelected).toHaveBeenLastCalledWith(1e-5, 0);
      expect(up.defaultPrevented).toBe(true);

      press("ArrowDown");
      expect(onNudgeSelected).toHaveBeenLastCalledWith(-1e-5, 0);

      press("ArrowLeft");
      expect(onNudgeSelected).toHaveBeenLastCalledWith(0, -1e-5);

      press("ArrowRight");
      expect(onNudgeSelected).toHaveBeenLastCalledWith(0, 1e-5);
    });

    it("uses a coarser step when Shift is held", () => {
      const onNudgeSelected = vi.fn();
      const params = makeParams({ selectedWaypointId: "wp-1", onNudgeSelected });
      renderHook(() => useKeyboardShortcuts(params));

      press("ArrowUp", { shiftKey: true });
      expect(onNudgeSelected).toHaveBeenLastCalledWith(1e-4, 0);
    });

    it("does not nudge (or preventDefault) with no selected waypoint", () => {
      const onNudgeSelected = vi.fn();
      const params = makeParams({ selectedWaypointId: null, onNudgeSelected });
      renderHook(() => useKeyboardShortcuts(params));

      const up = press("ArrowUp");
      expect(onNudgeSelected).not.toHaveBeenCalled();
      expect(up.defaultPrevented).toBe(false);
    });

    it("ignores arrows while typing in a field", () => {
      const onNudgeSelected = vi.fn();
      const params = makeParams({ selectedWaypointId: "wp-1", onNudgeSelected });
      renderHook(() => useKeyboardShortcuts(params));

      press("ArrowUp", { typing: true });
      expect(onNudgeSelected).not.toHaveBeenCalled();
    });
  });

  describe("copy / paste of the selected waypoint(s)", () => {
    it("Cmd/Ctrl+C fires onCopy when no text is selected", () => {
      const onCopy = vi.fn();
      const params = makeParams({ selectedWaypointId: "wp-1", onCopy });
      renderHook(() => useKeyboardShortcuts(params));

      const e = press("c", { metaKey: true });
      expect(onCopy).toHaveBeenCalledTimes(1);
      expect(e.defaultPrevented).toBe(true);
    });

    it("Cmd/Ctrl+V fires onPaste", () => {
      const onPaste = vi.fn();
      const params = makeParams({ onPaste });
      renderHook(() => useKeyboardShortcuts(params));

      const e = press("v", { metaKey: true });
      expect(onPaste).toHaveBeenCalledTimes(1);
      expect(e.defaultPrevented).toBe(true);
    });

    it("does not fire copy/paste while typing in a field", () => {
      const onCopy = vi.fn();
      const onPaste = vi.fn();
      const params = makeParams({ selectedWaypointId: "wp-1", onCopy, onPaste });
      renderHook(() => useKeyboardShortcuts(params));

      press("c", { metaKey: true, typing: true });
      press("v", { metaKey: true, typing: true });
      expect(onCopy).not.toHaveBeenCalled();
      expect(onPaste).not.toHaveBeenCalled();
    });

    it("plain 'c' still selects the circle tool (copy needs the modifier)", () => {
      const onCopy = vi.fn();
      const params = makeParams({ onCopy });
      renderHook(() => useKeyboardShortcuts(params));

      press("c");
      expect(params.setActiveTool).toHaveBeenCalledWith("circle");
      expect(onCopy).not.toHaveBeenCalled();
    });

    it("does not hijack Cmd/Ctrl+C while text is selected on the page", () => {
      const onCopy = vi.fn();
      const params = makeParams({ selectedWaypointId: "wp-1", onCopy });
      renderHook(() => useKeyboardShortcuts(params));

      const original = window.getSelection;
      window.getSelection = () =>
        ({ toString: () => "highlighted text" }) as unknown as Selection;
      try {
        const e = press("c", { metaKey: true });
        expect(onCopy).not.toHaveBeenCalled();
        expect(e.defaultPrevented).toBe(false);
      } finally {
        window.getSelection = original;
      }
    });
  });
});
