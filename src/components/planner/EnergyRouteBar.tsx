/**
 * @module EnergyRouteBar
 * @description The route as one horizontal bar, scaled to flight time and cut
 * into one span per battery pack, with a tick and "⚡n" label where each later
 * pack takes over. The tick sits at the moment the outgoing pack reaches its
 * last waypoint, so the spans read as the share of the route each pack flies.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import type { FlightPlan } from "@/lib/simulation-utils";
import type { BatterySplit } from "@/lib/energy/battery-split";
import { cn } from "@/lib/utils";

/**
 * Where each pack's span ends, as a fraction of the flight: the first arrival
 * at the pack's last waypoint after the previous pack's end. The last pack
 * ends at 1.
 */
export function packEndFractions(plan: FlightPlan, packs: readonly BatterySplit[]): number[] {
  const total = plan.totalDuration;
  if (total <= 0) return packs.map(() => 1);
  const arrivals: { index: number; at: number }[] = [];
  let elapsed = 0;
  for (const seg of plan.segments) {
    elapsed += seg.duration;
    arrivals.push({ index: seg.toIndex, at: elapsed });
  }
  let previous = 0;
  return packs.map((pack, k) => {
    if (k === packs.length - 1) return 1;
    const hit = arrivals.find((a) => a.index === pack.toIndex && a.at >= previous);
    previous = hit ? hit.at : previous;
    return Math.min(1, previous / total);
  });
}

interface EnergyRouteBarProps {
  plan: FlightPlan;
  packs: readonly BatterySplit[];
}

export function EnergyRouteBar({ plan, packs }: EnergyRouteBarProps) {
  const t = useTranslations("planner.energy");
  const ends = packEndFractions(plan, packs);

  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-3 w-full overflow-visible">
        <div className="flex h-full w-full overflow-hidden rounded-sm bg-bg-tertiary">
          {packs.map((pack, k) => {
            const start = k === 0 ? 0 : ends[k - 1];
            const label = t("packRange", { n: k + 1, from: pack.fromIndex + 1, to: pack.toIndex + 1 });
            return (
              <div
                key={`${pack.fromIndex}-${k}`}
                title={label}
                aria-label={label}
                role="img"
                className={cn("h-full", k % 2 === 0 ? "bg-accent-primary/70" : "bg-accent-primary/35")}
                style={{ width: `${Math.max(0, ends[k] - start) * 100}%` }}
              />
            );
          })}
        </div>
        {packs.slice(1).map((pack, i) => (
          <span
            key={`tick-${pack.fromIndex}-${i}`}
            aria-hidden
            className="absolute -top-0.5 -bottom-0.5 w-px bg-text-primary"
            style={{ left: `${ends[i] * 100}%` }}
          />
        ))}
      </div>
      <div className="relative h-4 w-full text-[11px] font-mono text-text-tertiary">
        <span className="absolute left-0">{t("routeStart")}</span>
        {packs.slice(1).map((pack, i) => (
          <span
            key={`label-${pack.fromIndex}-${i}`}
            title={t("changeTitle", { n: i + 2, wp: pack.fromIndex + 1 })}
            className="absolute -translate-x-1/2 whitespace-nowrap text-text-secondary"
            style={{ left: `${ends[i] * 100}%` }}
          >
            {t("changeTick", { n: i + 2, wp: pack.fromIndex + 1 })}
          </span>
        ))}
        <span className="absolute right-0">{t("routeEnd")}</span>
      </div>
    </div>
  );
}
