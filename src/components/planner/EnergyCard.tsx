/**
 * @module EnergyCard
 * @description The planner dock's Energy tab. Left: the battery pack the plan
 * flies on (with the pack editor), its reserve, the plan's totals and one row
 * per pack with its energy and flight time; a later pack's row resumes the
 * plan from where that pack takes over. Right: the route as a bar split per
 * pack, ticked where the packs change.
 *
 * Everything comes from the shared flight plan and energy estimate, so it
 * matches the dock statistics and the map's battery-change badges: hover-class
 * time (holds, loiters, climbs and descents) at the pack's hover power, the
 * rest at cruise power, derated for the Site tab's forecast when there is one.
 * With no flight yet every figure shows an honest em-dash.
 * @license GPL-3.0-only
 */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Zap, Clock, BatteryCharging, Play, SlidersHorizontal } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PropertyRow } from "@/components/ui/property-row";
import { ScrubNumberField } from "@/components/ui/scrub-number-field";
import { usePlanEnergy } from "@/hooks/use-planner-flight-plan";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useSettingsStore } from "@/stores/settings-store";
import { BatteryPacksModal } from "./BatteryPacksModal";
import { EnergyRouteBar } from "./EnergyRouteBar";

const PLACEHOLDER = "—";
const SECTION_LABEL = "font-body text-[11px] font-semibold text-text-tertiary";

/** "42m" under an hour, "1h 12m" at or above it. */
function fmtMinutes(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total}m`;
  return `${Math.floor(total / 60)}h ${total % 60}m`;
}

export function EnergyCard() {
  const t = useTranslations("planner.energy");
  const { plan, pack, energy, forecastApplied } = usePlanEnergy();
  const packs = useSettingsStore((s) => s.batteryProfiles);
  const selectBatteryProfile = useSettingsStore((s) => s.selectBatteryProfile);
  const updateBatteryProfile = useSettingsStore((s) => s.updateBatteryProfile);
  const waypointCount = useMissionStore((s) => s.waypoints.length);
  const openSendDialog = usePlannerStore((s) => s.openSendDialog);
  const [editorOpen, setEditorOpen] = useState(false);

  const plus = plan.openEnded ? "+" : "";
  const totals: { key: string; label: string; icon: typeof Zap; value: string }[] = [
    { key: "energy", label: t("required"), icon: Zap, value: energy ? `${Math.round(energy.totalWh)}${plus} Wh` : PLACEHOLDER },
    { key: "time", label: t("flightTime"), icon: Clock, value: energy ? `${fmtMinutes(energy.flightMinutes)}${plus}` : PLACEHOLDER },
    {
      key: "swaps",
      label: t("swaps"),
      icon: BatteryCharging,
      value: energy ? String(Math.max(0, energy.packs.length - 1)) : PLACEHOLDER,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-xs md:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
      <section className="flex min-w-0 flex-col gap-1.5" aria-label={t("packSection")}>
        <PropertyRow label={t("battery")}>
          <div className="flex min-w-0 items-center gap-1">
            <div className="min-w-0 flex-1">
              <Select
                compact
                ariaLabel={t("battery")}
                value={pack.id}
                onChange={selectBatteryProfile}
                options={packs.map((p) => ({ value: p.id, label: p.name }))}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={<SlidersHorizontal size={12} />}
              onClick={() => setEditorOpen(true)}
              className="shrink-0"
            >
              {t("editPacks")}
            </Button>
          </div>
        </PropertyRow>
        <PropertyRow label={t("reserve")} hint={t("reserveHint")}>
          <ScrubNumberField
            value={pack.reservePct}
            onCommit={(v) => updateBatteryProfile(pack.id, { reservePct: v })}
            min={0}
            max={90}
            step={1}
            unit="%"
            ariaLabel={t("reserve")}
          />
        </PropertyRow>

        <div className="mt-1 flex flex-col gap-1">
          {totals.map((r) => {
            const Icon = r.icon;
            return (
              <div key={r.key} className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
                <span className="text-text-secondary">{r.label}</span>
                <span className="ml-auto font-mono tabular-nums text-text-primary">{r.value}</span>
              </div>
            );
          })}
        </div>

        {energy && energy.packs.length > 0 && (
          <ul className="mt-1 flex flex-col gap-0.5" aria-label={t("perPack")}>
            {energy.packs.map((p, i) => {
              const resumable = p.fromIndex > 0 && p.fromIndex < waypointCount;
              return (
                <li key={`${p.fromIndex}-${p.toIndex}-${i}`} className="flex min-h-6 items-center gap-2 text-text-secondary">
                  <span className="min-w-0 truncate">
                    {t("packRange", { n: i + 1, from: p.fromIndex + 1, to: p.toIndex + 1 })}
                  </span>
                  <span className="ml-auto shrink-0 font-mono tabular-nums text-text-primary">
                    {Math.round(p.energyWh)} Wh · {fmtMinutes(p.durationS / 60)}
                  </span>
                  {resumable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Play size={11} />}
                      onClick={() => openSendDialog({ resumeFromIndex: p.fromIndex })}
                      title={t("resumeTitle", { n: i + 1, wp: p.fromIndex + 1 })}
                      className="h-6 shrink-0 px-1.5"
                    >
                      {t("resumeFrom", { wp: p.fromIndex + 1 })}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-2" aria-label={t("routeSection")}>
        <h3 className={SECTION_LABEL}>{t("routeTitle")}</h3>
        {energy && energy.packs.length > 0 ? (
          <EnergyRouteBar plan={plan} packs={energy.packs} />
        ) : (
          <p className="text-[11px] text-text-tertiary">{t("noFlight")}</p>
        )}
        <p className="text-[11px] leading-snug text-text-tertiary">
          {t("profileNote", { pack: pack.name, capacity: Math.round(pack.capacityWh), reserve: Math.round(pack.reservePct) })}
          {forecastApplied ? ` ${t("forecastNote")}` : ""}
        </p>
      </section>

      <BatteryPacksModal open={editorOpen} onClose={() => setEditorOpen(false)} />
    </div>
  );
}
