/**
 * @module planner-commands
 * @description Builds the mission-planner command-palette verbs. Every action
 * reachable by a shortcut comes from the single PLANNER_SHORTCUTS table; every
 * planner-bar menu action, panel toggle and dock tab is added from
 * {@link MENU_COMMANDS}, so nothing the planner can do is missing from ⌘K.
 * Registered by the planner page while it is mounted.
 * @license GPL-3.0-only
 */

import type { PaletteCommand } from "@/lib/command-palette-registry";
import type { PlannerTool } from "@/lib/types";
import { PLANNER_SHORTCUTS } from "@/lib/planner-shortcuts";
import { DOCK_TABS, type DockTab } from "@/stores/planner-store";

/** The planner handlers a command needs to invoke. */
export interface PlannerCommandHandlers {
  setActiveTool: (tool: PlannerTool) => void;
  undo: () => void;
  redo: () => void;
  handleSave: () => void;
  handleSaveAs?: () => void;
  handleNewPlan?: () => void;
  toggleTerrain: () => void;
  togglePattern: () => void;
  toggleValidation: () => void;
  toggleOverlays: () => void;
  togglePlans: () => void;
  toggleOutline: () => void;
  toggleInspector: () => void;
  togglePanels: () => void;
  openDock: (tab: DockTab) => void;
  sendToVehicle: () => void;
  downloadFromDrone: () => void;
  importBoundary: () => void;
  exportNative: () => void;
  exportWaypoints: () => void;
  exportPlan: () => void;
  exportKML: () => void;
  exportKMZ: () => void;
  exportCSV: () => void;
  exportBrief: () => void;
  copyShareLink: () => void;
  reverseWaypoints: () => void;
  transformMission: () => void;
  simulate: () => void;
  discardPlan: () => void;
}

/**
 * Map a shortcut to the planner handler it invokes, or null when the shortcut is
 * context-dependent (delete/cancel/nudge/copy/paste and the click gestures act
 * on the current selection or draw and have no standalone palette verb).
 */
function actionFor(labelKey: string, h: PlannerCommandHandlers): (() => void) | null {
  const s = PLANNER_SHORTCUTS.find((x) => x.labelKey === labelKey);
  if (!s) return null;
  if (s.group === "tool" && s.tool) return () => h.setActiveTool(s.tool!);
  switch (labelKey) {
    case "shortcuts.terrain": return h.toggleTerrain;
    case "shortcuts.patterns": return h.togglePattern;
    case "shortcuts.validation": return h.toggleValidation;
    case "shortcuts.overlays": return h.toggleOverlays;
    case "shortcuts.outline": return h.toggleOutline;
    case "shortcuts.inspector": return h.toggleInspector;
    case "shortcuts.focusMap": return h.togglePanels;
    case "shortcuts.openPlans": return h.togglePlans;
    case "shortcuts.undo": return h.undo;
    case "shortcuts.redo": return h.redo;
    case "shortcuts.save": return h.handleSave;
    case "shortcuts.saveAs": return h.handleSaveAs ?? null;
    case "shortcuts.newPlan": return h.handleNewPlan ?? null;
    default: return null;
  }
}

/** Planner-bar menu verbs with no shortcut, keyed by their `planner` label key. */
const MENU_COMMANDS: readonly { labelKey: string; run: (h: PlannerCommandHandlers) => void }[] = [
  { labelKey: "commands.sendToVehicle", run: (h) => h.sendToVehicle() },
  { labelKey: "commands.downloadFromDrone", run: (h) => h.downloadFromDrone() },
  { labelKey: "commands.importBoundary", run: (h) => h.importBoundary() },
  { labelKey: "commands.exportNative", run: (h) => h.exportNative() },
  { labelKey: "commands.exportWaypoints", run: (h) => h.exportWaypoints() },
  { labelKey: "commands.exportPlan", run: (h) => h.exportPlan() },
  { labelKey: "commands.exportKml", run: (h) => h.exportKML() },
  { labelKey: "commands.exportKmz", run: (h) => h.exportKMZ() },
  { labelKey: "commands.exportCsv", run: (h) => h.exportCSV() },
  { labelKey: "commands.exportBrief", run: (h) => h.exportBrief() },
  { labelKey: "commands.copyShareLink", run: (h) => h.copyShareLink() },
  { labelKey: "commands.reverseWaypoints", run: (h) => h.reverseWaypoints() },
  { labelKey: "commands.transformMission", run: (h) => h.transformMission() },
  { labelKey: "commands.simulate", run: (h) => h.simulate() },
  { labelKey: "commands.discardPlan", run: (h) => h.discardPlan() },
  ...DOCK_TABS.map((tab) => ({ labelKey: `commands.dock.${tab}`, run: (h: PlannerCommandHandlers) => h.openDock(tab) })),
];

/**
 * Build the planner palette commands. `label(labelKey)` and `category` are the
 * already-translated strings supplied by the caller; `query` filters by label
 * (the palette does not re-filter provider results).
 */
export function buildPlannerCommands(
  h: PlannerCommandHandlers,
  label: (labelKey: string) => string,
  category: string,
  query: string,
): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  const cmds: PaletteCommand[] = [];
  const push = (labelKey: string, action: () => void) => {
    const text = label(labelKey);
    if (q && !text.toLowerCase().includes(q)) return;
    cmds.push({ id: `planner-${labelKey}`, label: text, category, action });
  };
  for (const s of PLANNER_SHORTCUTS) {
    const action = actionFor(s.labelKey, h);
    if (action) push(s.labelKey, action);
  }
  for (const c of MENU_COMMANDS) push(c.labelKey, () => c.run(h));
  return cmds;
}
