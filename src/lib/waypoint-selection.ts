/**
 * @module waypoint-selection
 * @description Whether a waypoint is part of the planner selection: the single
 * selected waypoint or a member of the Ctrl/Shift multi-selection. The 2D map,
 * the 3D view and the outline all highlight the same set.
 * @license GPL-3.0-only
 */

export function isWaypointSelected(id: string, selectedId: string | null, selectedIds: readonly string[]): boolean {
  return id === selectedId || selectedIds.includes(id);
}
