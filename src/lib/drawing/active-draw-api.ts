/**
 * The imperative drawing surface the single planner keyboard dispatcher acts on.
 * The map component registers the live drawing manager here; the dispatcher
 * reads it. This is the seam that lets one keyboard owner reach the active draw
 * without the manager registering its own document listeners.
 *
 * This module imports nothing from Leaflet, so server-rendered modules (the
 * planner page and its keyboard hook) can depend on it. Leaflet touches
 * `window` at import time and must stay behind client-only imports.
 *
 * @license GPL-3.0-only
 */

export interface ActiveDrawApi {
  /** True while a polygon / circle / measure draw is in progress. */
  isDrawing(): boolean;
  /** Cancel the active draw (Escape). No-op when not drawing. */
  cancel(): void;
  /** Remove the last polygon vertex (Backspace while drawing). No-op otherwise. */
  popVertex(): void;
  /** Finish the active draw (e.g. Enter). No-op when not completable. */
  complete(): void;
}

let activeDrawApi: ActiveDrawApi | null = null;

/**
 * Register (or clear, with `null`) the active draw surface. The map component
 * calls this when its manager is created / torn down so the keyboard dispatcher
 * can reach the live draw. A single global is correct here: only one planner map
 * is mounted at a time.
 */
export function registerActiveDrawApi(api: ActiveDrawApi | null): void {
  activeDrawApi = api;
}

/** Read the currently registered active draw surface, or `null` when none. */
export function getActiveDrawApi(): ActiveDrawApi | null {
  return activeDrawApi;
}
