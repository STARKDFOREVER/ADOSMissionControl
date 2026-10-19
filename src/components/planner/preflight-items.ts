/**
 * @module preflight-items
 * @description The item ids the planner's pre-flight checklist renders, for
 * surfaces that summarise progress (dock tab badge, send dialog) without
 * rendering the checklist itself.
 * @license GPL-3.0-only
 */

import { DEFAULT_CHECKLIST, type CheckedMap } from "@/lib/preflight-checklist";

export const PREFLIGHT_ITEM_IDS: readonly string[] = DEFAULT_CHECKLIST.map((item) => item.id);

/** How many of the checklist's items are ticked in `checked`. */
export function countCheckedPreflightItems(checked: CheckedMap): number {
  let n = 0;
  for (const id of PREFLIGHT_ITEM_IDS) if (checked[id]) n++;
  return n;
}
