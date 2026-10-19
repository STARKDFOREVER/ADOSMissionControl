/**
 * @module DockStats
 * @description Mission summary in the dock strip: waypoint count, total
 * distance, estimated time, max altitude and the mean speed over the planned
 * route (distance / planned duration). Uses the flight plan's 3D distance and
 * duration so the figures match the simulation.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Waypoint } from "@/lib/types";
import { computeFlightPlan } from "@/lib/simulation-utils";
import { useFlightPlanOptions } from "@/hooks/use-rtl-return-context";
import { useSettingsStore } from "@/stores/settings-store";
import { formatDistance, formatAltitude, formatSpeed } from "@/lib/units/format";

interface DockStatsProps {
  waypoints: Waypoint[];
  defaultSpeed: number;
}

export function DockStats({ waypoints, defaultSpeed }: DockStatsProps) {
  const t = useTranslations("planner.dock.stats");
  const units = useSettingsStore((s) => s.units);
  const planOptions = useFlightPlanOptions();
  const stats = useMemo(() => {
    const plan = computeFlightPlan(waypoints, defaultSpeed, planOptions);
    let maxAlt = 0;
    for (const wp of waypoints) {
      if (wp.alt > maxAlt) maxAlt = wp.alt;
    }
    // The plan's own duration already accounts for per-leg speed overrides and
    // hold/loiter times, so the ETA matches the simulation's playback length.
    const duration = plan.totalDuration;
    return {
      distance: plan.totalDistance,
      etaMin: Math.ceil(duration / 60),
      maxAlt,
      // Null when the plan has no duration to divide by.
      avgSpeed: duration > 0 ? plan.totalDistance / duration : null,
    };
  }, [waypoints, defaultSpeed, planOptions]);

  if (waypoints.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap">
      <Stat title={t("waypointsTitle")}>{t("waypoints", { count: waypoints.length })}</Stat>
      <Stat title={t("distanceTitle")}>{formatDistance(stats.distance, units)}</Stat>
      <Stat title={t("etaTitle")}>{t("eta", { minutes: stats.etaMin })}</Stat>
      <Stat title={t("maxAltTitle")}>{t("maxAlt", { value: formatAltitude(stats.maxAlt, units) })}</Stat>
      {stats.avgSpeed !== null && (
        <Stat title={t("avgSpeedTitle")}>
          {t("avgSpeed", { value: formatSpeed(stats.avgSpeed, units) })}
        </Stat>
      )}
    </div>
  );
}

function Stat({ title, children }: { title: string; children: string }) {
  return (
    <span title={title} className="text-[11px] font-mono tabular-nums text-text-secondary">
      {children}
    </span>
  );
}
