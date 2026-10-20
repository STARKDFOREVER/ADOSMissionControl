/**
 * @module EnergyCard
 * @description Planner review card estimating a mission's energy budget from
 * the same flight plan the dock statistics and the simulation use: hover-class
 * time (holds, loiters, climbs and descents) at the pack's hover power, the
 * rest at its cruise power, derated for the site forecast's wind and
 * temperature when the Site tab has one. The plan is split across packs of the
 * selected battery profile, each ending where the next waypoint would leave
 * too little charge to fly home with the reserve intact.
 *
 * With no flight yet every figure shows an honest em-dash rather than a
 * fabricated number.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Zap, Clock, BatteryCharging } from "lucide-react";
import type { Waypoint } from "@/lib/types";
import { computeFlightPlan } from "@/lib/flight-plan";
import { estimatePlanEnergy } from "@/lib/energy-model";
import { useFlightPlanOptions } from "@/hooks/use-rtl-return-context";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_BATTERY_PROFILE } from "@/stores/settings/planning-slice";
import { useSiteWeatherStore } from "@/stores/site-weather-store";

const PLACEHOLDER = "—";

interface EnergyCardProps {
  /** The planner's waypoints. */
  waypoints: Waypoint[];
  /** Mission default speed, m/s. */
  defaultSpeed: number;
}

/** "42m" under an hour, "1h 12m" at or above it. */
function fmtMinutes(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total}m`;
  return `${Math.floor(total / 60)}h ${total % 60}m`;
}

export function EnergyCard({ waypoints, defaultSpeed }: EnergyCardProps) {
  const t = useTranslations("planner.energy");
  const planOptions = useFlightPlanOptions();
  const packs = useSettingsStore((s) => s.batteryProfiles);
  const selectedId = useSettingsStore((s) => s.selectedBatteryProfileId);
  const forecast = useSiteWeatherStore((s) => s.report);
  const pack = packs.find((p) => p.id === selectedId) ?? DEFAULT_BATTERY_PROFILE;
  const windMps = forecast?.windSpeedMps ?? null;
  const tempC = forecast?.temperatureC ?? null;

  const est = useMemo(() => {
    const plan = computeFlightPlan(waypoints, defaultSpeed, planOptions);
    const energy = estimatePlanEnergy(plan, waypoints, pack, { windMps, tempC });
    return energy ? { plan, energy } : null;
  }, [waypoints, defaultSpeed, planOptions, pack, windMps, tempC]);

  const openEnded = est?.plan.openEnded ?? false;
  const rows: { key: string; label: string; icon: typeof Zap; value: string }[] = [
    {
      key: "energy",
      label: t("required"),
      icon: Zap,
      value: est ? `${Math.round(est.energy.totalWh)}${openEnded ? "+" : ""} Wh` : PLACEHOLDER,
    },
    {
      key: "time",
      label: t("flightTime"),
      icon: Clock,
      value: est ? `${fmtMinutes(est.energy.flightMinutes)}${openEnded ? "+" : ""}` : PLACEHOLDER,
    },
    {
      key: "swaps",
      label: t("swaps"),
      icon: BatteryCharging,
      value: est ? String(Math.max(0, est.energy.packs.length - 1)) : PLACEHOLDER,
    },
  ];

  return (
    <div className="text-xs">
      <div className="grid grid-cols-1 gap-1.5">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.key} className="flex items-center gap-2">
              <Icon className="w-3.5 h-3.5 text-text-secondary shrink-0" />
              <span className="text-text-secondary">{r.label}</span>
              <span className="ml-auto font-mono text-text-primary tabular-nums">{r.value}</span>
            </div>
          );
        })}
      </div>

      {est && est.energy.packs.length > 1 && (
        <ul className="mt-2 flex flex-col gap-0.5">
          {est.energy.packs.map((p, i) => (
            <li key={`${p.fromIndex}-${p.toIndex}-${i}`} className="flex items-center gap-2 text-text-secondary">
              <span>{t("packRange", { n: i + 1, from: p.fromIndex + 1, to: p.toIndex + 1 })}</span>
              <span className="ml-auto font-mono tabular-nums text-text-primary">
                {Math.round(p.energyWh)} Wh · {fmtMinutes(p.durationS / 60)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] leading-snug text-text-tertiary">
        {t("profileNote", { pack: pack.name, capacity: Math.round(pack.capacityWh), reserve: Math.round(pack.reservePct) })}
        {windMps !== null || tempC !== null ? ` ${t("forecastNote")}` : ""}
      </p>
    </div>
  );
}
