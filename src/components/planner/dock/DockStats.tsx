/**
 * @module DockStats
 * @description Mission summary in the dock strip: waypoint count, horizontal
 * distance (the legs from home and back included), estimated time, the highest
 * point above home and the mean speed over the route. Every figure comes from
 * the flight plan, so it matches the simulation. An ETA that ends in an
 * unlimited loiter gets a "+"; a height resolved without a known ground datum
 * gets a "~".
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Waypoint } from "@/lib/types";
import { computeFlightPlan } from "@/lib/flight-plan";
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
  const plan = useMemo(
    () => computeFlightPlan(waypoints, defaultSpeed, planOptions),
    [waypoints, defaultSpeed, planOptions],
  );

  if (waypoints.length === 0) return null;

  const duration = plan.totalDuration;
  const etaMin = Math.ceil(duration / 60);
  const avgSpeed = duration > 0 ? plan.totalDistance / duration : null;
  const maxAboveHome = formatAltitude(plan.maxAboveHomeM, units);

  return (
    <div className="flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap">
      <Stat title={t("waypointsTitle")}>{t("waypoints", { count: waypoints.length })}</Stat>
      <Stat title={t("distanceTitle")}>{formatDistance(plan.totalDistance, units)}</Stat>
      {plan.openEnded ? (
        <Stat title={t("etaOpenTitle")}>{t("etaOpen", { minutes: etaMin })}</Stat>
      ) : (
        <Stat title={t("etaTitle")}>{t("eta", { minutes: etaMin })}</Stat>
      )}
      <Stat title={t("maxAboveHomeTitle")}>
        {t("maxAboveHome", { value: plan.altitudesApproximate ? `~${maxAboveHome}` : maxAboveHome })}
      </Stat>
      {avgSpeed !== null && (
        <Stat title={t("avgSpeedTitle")}>{t("avgSpeed", { value: formatSpeed(avgSpeed, units) })}</Stat>
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
