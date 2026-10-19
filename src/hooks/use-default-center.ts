/**
 * @module use-default-center
 * @description Returns the user's GPS position as map center if available,
 * otherwise falls back to Null Island (0, 0). `located` tells the caller which
 * one it got, so it can pair the unlocated centre with a globe-wide zoom.
 * @license GPL-3.0-only
 */

import { useSettingsStore } from "@/stores/settings-store";
import { useGcsLocationStore } from "@/stores/gcs-location-store";
import { DEFAULT_CENTER } from "@/lib/map-constants";

export function useDefaultCenter(): { center: [number, number]; located: boolean } {
  const locationEnabled = useSettingsStore((s) => s.locationEnabled);
  const position = useGcsLocationStore((s) => s.position);
  if (locationEnabled && position) return { center: [position.lat, position.lon], located: true };
  return { center: DEFAULT_CENTER, located: false };
}
