/**
 * @module use-vehicle-options
 * @description Options for the planner's vehicle assignment select: every idle
 * or online drone, labelled with its battery reading.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import type { FleetDrone, SelectOption } from "@/lib/types";
import { isFresh } from "@/lib/telemetry/freshness";
import { knownRemainingPct } from "@/lib/battery";
import { useClockTick } from "@/lib/agent/freshness";
import { useClockStore } from "@/stores/clock-store";

export function useVehicleOptions(drones: FleetDrone[]): SelectOption[] {
  const t = useTranslations("planner");
  // Re-render on the shared 1 Hz clock so a battery reading ages into "stale".
  useClockTick();
  const now = useClockStore((s) => s.now);
  const availableDrones = drones.filter((d) => d.status === "idle" || d.status === "online");
  return [
    { value: "", label: t("selectDrone") },
    ...availableDrones.map((d) => ({
      value: d.id,
      label: `${d.name} (${batteryLabel(d, now, t("batteryStale"))})`,
    })),
  ];
}

/**
 * Battery figure for a drone row: "—" when there is no FC battery reading
 * (no FC linked, nothing received yet, or the FC reports the level unknown),
 * and the percentage marked stale once the reading stops updating.
 */
function batteryLabel(d: FleetDrone, now: number, staleLabel: string): string {
  const battery = d.fcAttached === false ? undefined : d.battery;
  const remaining = knownRemainingPct(battery?.remaining);
  if (!battery || remaining === null) return "—";
  const pct = `${Math.round(remaining)}%`;
  return isFresh(battery.timestamp, now) ? pct : `${pct}, ${staleLabel}`;
}
