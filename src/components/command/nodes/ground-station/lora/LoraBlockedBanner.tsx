"use client";

/**
 * @module ground-station/lora/LoraBlockedBanner
 * @description Shown whenever the governor refuses transmission
 * (`tx_allowed: false`). Names the reason in words and offers the fix:
 * a region problem opens the region picker (and the country setting), a
 * waiting rule shows the local countdown to the next admitted frame, and a
 * power problem opens the channel and power settings. Receive keeps working
 * in every blocked state.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Ban, PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LoraStatus } from "@/lib/api/ground-station-api";
import { formatCountdown } from "./lora-format";

/** Reasons that clear on their own once the rule's window moves on. */
const WAITING: Record<string, true> = { duty_exhausted: true, dwell_time: true, lbt_busy: true };

const KNOWN_REASONS: Record<string, true> = {
  region_unset: true,
  module_band_mismatch: true,
  duty_exhausted: true,
  dwell_time: true,
  lbt_busy: true,
  power_over_limit: true,
};

interface LoraBlockedBannerProps {
  status: LoraStatus;
  /** Milliseconds until the next frame is admitted, counted down locally. */
  remainingMs: number;
  onOpenRegionPicker: () => void;
  onOpenCountrySetting?: () => void;
  onOpenPowerSettings: () => void;
}

export function LoraBlockedBanner({
  status,
  remainingMs,
  onOpenRegionPicker,
  onOpenCountrySetting,
  onOpenPowerSettings,
}: LoraBlockedBannerProps) {
  const t = useTranslations("groundStationLanes.lora.blocked");
  if (status.tx_allowed) return null;
  const reason = status.blocked_reason ?? "region_unset";
  const waiting = Object.hasOwn(WAITING, reason);
  const Icon = waiting ? PauseCircle : Ban;
  const band = status.region?.band_mhz;
  const text = Object.hasOwn(KNOWN_REASONS, reason)
    ? t(`reason.${reason}`, {
        module: status.module_band ?? "?",
        plan: status.region?.plan_id ?? "?",
        lo: band ? band[0].toFixed(1) : "?",
        hi: band ? band[1].toFixed(1) : "?",
      })
    : t("reasonUnknown", { reason });

  return (
    <div
      role="alert"
      className={
        waiting
          ? "rounded border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-status-warning"
          : "rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-status-error"
      }
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
        <Icon size={14} className="shrink-0" />
        {waiting ? t("paused") : t("title")}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-text-primary">{text}</p>
      {waiting && remainingMs > 0 ? (
        <p className="mt-1 font-mono text-xs tabular-nums">
          {t("countdown", { time: formatCountdown(remainingMs) })}
        </p>
      ) : null}
      {reason === "region_unset" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onOpenRegionPicker}>
            {t("action.setRegion")}
          </Button>
          {onOpenCountrySetting ? (
            <Button size="sm" variant="ghost" onClick={onOpenCountrySetting}>
              {t("action.countrySetting")}
            </Button>
          ) : null}
        </div>
      ) : reason === "module_band_mismatch" ? (
        <div className="mt-2">
          <Button size="sm" variant="secondary" onClick={onOpenRegionPicker}>
            {t("action.changeRegion")}
          </Button>
        </div>
      ) : reason === "power_over_limit" ? (
        <div className="mt-2">
          <Button size="sm" variant="secondary" onClick={onOpenPowerSettings}>
            {t("action.powerSettings")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
