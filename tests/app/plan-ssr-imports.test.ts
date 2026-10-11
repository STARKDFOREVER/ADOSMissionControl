// @vitest-environment node
/**
 * The planner route is server-rendered before it hydrates. Leaflet touches
 * `window` at import time, so any module the page imports statically must load
 * without a DOM; a direct load of /plan otherwise answers 500 ("window is not
 * defined"). The map and drawing manager stay behind client-only imports, so
 * this file fails to load at all if one of these imports reaches Leaflet.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import MissionPlannerPage from "@/app/plan/page";
import { useKeyboardShortcuts } from "@/app/plan/use-keyboard-shortcuts";
import { getActiveDrawApi } from "@/lib/drawing/active-draw-api";

describe("planner server render imports", () => {
  it("loads the planner page and its keyboard dispatcher without a window", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof MissionPlannerPage).toBe("function");
    expect(typeof useKeyboardShortcuts).toBe("function");
    expect(getActiveDrawApi()).toBeNull();
  });
});
