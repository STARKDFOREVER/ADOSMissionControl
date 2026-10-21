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

import { useTranslations } from "next-intl";
import { usePlannerFlightPlan } from "@/hooks/use-planner-flight-plan";
import { useMissionStore } from "@/stores/mission-store";
import { useSettingsStore } from "@/stores/settings-store";
import { formatDistance, formatAltitude, formatSpeed } from "@/lib/units/format";

export function DockStats() {
  const t = useTranslations("planner.dock.stats");
  const units = useSettingsStore((s) => s.units);
  const waypointCount = useMissionStore((s) => s.waypoints.length);
  const plan = usePlannerFlightPlan();

  if (waypointCount === 0) return null;

  const duration = plan.totalDuration;
  const etaMin = Math.ceil(duration / 60);
  const avgSpeed = duration > 0 ? plan.totalDistance / duration : null;
  const maxAboveHome = formatAltitude(plan.maxAboveHomeM, units);

  return (
    // One 16 px row; a stat that does not fit wraps onto a hidden second row
    // instead of being cut mid-word.
    <div className="flex h-4 min-w-0 flex-wrap items-center gap-x-3 overflow-hidden whitespace-nowrap">
      <Stat title={t("waypointsTitle")}>{t("waypoints", { count: waypointCount })}</Stat>
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
    <span title={title} className="text-[11px] leading-4 font-mono tabular-nums text-text-secondary">
      {children}
    </span>
  );
}
