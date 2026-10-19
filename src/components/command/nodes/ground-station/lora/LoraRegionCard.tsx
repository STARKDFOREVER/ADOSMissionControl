"use client";

/**
 * @module ground-station/lora/LoraRegionCard
 * @description The active region (code, name, plan, band, where it came
 * from and the rule's legal source), the fitted module and channel, the
 * transmit verdict with the next-TX countdown, and the amber mismatch chips.
 * Hosts the channel and power settings form.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LoraStatus, LoraUpdate } from "@/lib/api/ground-station-api";
import { Chip, LaneCard, fmtNum } from "../lane-ui";
import { AIRBORNE_RESTRICTED, formatCountdown, parseBand } from "./lora-format";
import { LoraChannelForm } from "./LoraChannelForm";

const SOURCE_KEY: Record<string, string> = {
  "lora.region": "loraRegion",
  "network.regulatory.region": "countrySetting",
};

interface LoraRegionCardProps {
  status: LoraStatus;
  remainingMs: number;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onOpenRegionPicker: () => void;
  writeLock: string | null;
  applying: boolean;
  onApply: (body: LoraUpdate) => void;
}

export function LoraRegionCard({
  status,
  remainingMs,
  settingsOpen,
  onToggleSettings,
  onOpenRegionPicker,
  writeLock,
  applying,
  onApply,
}: LoraRegionCardProps) {
  const t = useTranslations("groundStationLanes.lora");
  const region = status.region;
  const channel = status.channel;
  const band = region?.band_mhz ?? null;
  const bandText = band ? t("region.band", { lo: band[0].toFixed(1), hi: band[1].toFixed(1) }) : null;
  const moduleBand = parseBand(status.module_band);
  const moduleCovers = !band || !moduleBand || (moduleBand[0] <= band[0] && moduleBand[1] >= band[1]);
  const moduleMismatch = status.blocked_reason === "module_band_mismatch" || !moduleCovers;
  const rulesEmpty = (status.governor?.rules.length ?? 0) === 0;
  const sourceKey = region ? SOURCE_KEY[region.source] : undefined;
  const tooltip = region ? [region.citation, bandText].filter(Boolean).join(" · ") : undefined;

  return (
    <LaneCard
      title={t("region.title")}
      icon={Globe}
      trailing={
        <Button size="sm" variant="secondary" onClick={onOpenRegionPicker}>
          {t("region.change")}
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {region ? (
          <span
            title={tooltip}
            className="inline-flex items-center gap-2 rounded border border-accent-primary/40 bg-accent-primary/10 px-2 py-0.5 font-mono text-accent-primary"
          >
            <span className="font-semibold">{region.code}</span>
            <span className="font-sans">{region.name}</span>
            <span>{region.plan_id}</span>
            {bandText ? <span>{bandText}</span> : null}
          </span>
        ) : (
          <Chip tone="error">{t("region.none")}</Chip>
        )}
        {region ? (
          <span className="text-text-tertiary">
            {t("region.from")} {sourceKey ? t(`region.source.${sourceKey}`) : region.source}
          </span>
        ) : null}
      </div>
      {region?.citation ? (
        <p className="mt-1 text-[11px] text-text-tertiary">{t("region.citation", { citation: region.citation })}</p>
      ) : null}
      {region && rulesEmpty && status.blocked_reason === "region_unset" ? (
        <p className="mt-1 text-[11px] text-status-warning">{t("region.noVerifiedPlan", { name: region.name })}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-text-primary">
        <span className="flex items-center gap-1.5 font-sans">
          <span className="text-text-secondary">{t("module.label")}</span>
          <span className="font-mono">
            {status.transport ?? "?"} ({status.module_band ?? "?"} MHz)
          </span>
          <Chip tone={moduleMismatch ? "warning" : "success"}>
            {moduleMismatch ? t("module.mismatch") : t("module.ok")}
          </Chip>
        </span>
        {channel ? (
          <>
            <span>{t("channel.freq", { freq: fmtNum(channel.freq_mhz, 3) })}</span>
            <span>{t("channel.bw", { bw: fmtNum(channel.bw_khz) })}</span>
            <span>{t("channel.sf", { sf: fmtNum(channel.sf) })}</span>
            <span>{t("channel.erp", { erp: fmtNum(channel.erp_mw), max: fmtNum(channel.max_erp_mw) })}</span>
          </>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-text-secondary">{t("tx.label")}</span>
        <Chip tone={status.tx_allowed ? "success" : "error"}>
          {status.tx_allowed ? t("tx.allowed") : t("tx.blocked")}
        </Chip>
        {status.tx_allowed ? (
          <span className="font-mono tabular-nums text-text-tertiary">
            {remainingMs > 0 ? t("tx.nextIn", { time: formatCountdown(remainingMs) }) : t("tx.nextNow")}
          </span>
        ) : null}
      </div>

      {(!moduleCovers && band && moduleBand) || (region && Object.hasOwn(AIRBORNE_RESTRICTED, region.code)) ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {!moduleCovers && band && moduleBand ? (
            <Chip tone="warning">
              {t("region.moduleBandChip", {
                module: status.module_band ?? "",
                lo: band[0].toFixed(1),
                hi: band[1].toFixed(1),
              })}
            </Chip>
          ) : null}
          {region && Object.hasOwn(AIRBORNE_RESTRICTED, region.code) ? (
            <Chip tone="warning">{t("region.airborneChip", { code: region.code })}</Chip>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3">
        <Button size="sm" variant="ghost" onClick={onToggleSettings} aria-expanded={settingsOpen}>
          {t("channel.settings")}
        </Button>
        {settingsOpen ? (
          <LoraChannelForm channel={channel} writeLock={writeLock} applying={applying} onApply={onApply} />
        ) : null}
      </div>
    </LaneCard>
  );
}
