/**
 * @module use-initial-planner-view
 * @description Resolves where the planner map opens: the operator's last view
 * when one was persisted, else their GPS fix, else the whole globe. The map
 * only reads its centre and zoom at mount, so later arrivals (a hydrated view,
 * a GPS fix) are applied by the map itself as one-shot recentres.
 * @license GPL-3.0-only
 */

import { useMemo, useSyncExternalStore } from "react";
import { usePlannerStore } from "@/stores/planner-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useGcsLocationStore } from "@/stores/gcs-location-store";
import { DEFAULT_CENTER, DEFAULT_ZOOM_UNLOCATED } from "@/lib/map-constants";

export type InitialViewSource = "persisted" | "gps" | "unlocated";

export interface InitialPlannerView {
  center: [number, number];
  zoom: number;
  source: InitialViewSource;
  /** Whether the persisted planner store has finished loading. */
  hydrated: boolean;
}

/** Zoom used when the view comes from the operator's GPS fix. */
export const GPS_VIEW_ZOOM = 15;

/** A persisted centre of exactly (0, 0) is the unlocated default, not a view. */
export function isRealCenter(center: [number, number] | undefined): center is [number, number] {
  return !!center && (center[0] !== 0 || center[1] !== 0);
}

/** Whether the persisted planner store has loaded; false on the server render. */
function usePlannerHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => usePlannerStore.persist.onFinishHydration(onChange),
    () => usePlannerStore.persist.hasHydrated(),
    () => false,
  );
}

export function useInitialPlannerView(): InitialPlannerView {
  const hydrated = usePlannerHydrated();
  // Snapshot the persisted view once hydration completes; subscribing to the
  // live centre would re-render on every pan and mask the first GPS recentre.
  const persisted = useMemo(() => {
    if (!hydrated) return null;
    const s = usePlannerStore.getState();
    return isRealCenter(s.mapCenter) ? { center: s.mapCenter, zoom: s.mapZoom } : null;
  }, [hydrated]);
  const locationEnabled = useSettingsStore((s) => s.locationEnabled);
  const position = useGcsLocationStore((s) => s.position);

  if (persisted) {
    return { center: persisted.center, zoom: persisted.zoom, source: "persisted", hydrated };
  }
  if (locationEnabled && position) {
    return { center: [position.lat, position.lon], zoom: GPS_VIEW_ZOOM, source: "gps", hydrated };
  }
  return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM_UNLOCATED, source: "unlocated", hydrated };
}
