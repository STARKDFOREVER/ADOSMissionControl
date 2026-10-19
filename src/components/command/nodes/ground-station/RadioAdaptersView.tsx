"use client";

/**
 * @module ground-station/RadioAdaptersView
 * @description Multi-adapter WFB view: a receive-diversity summary (receive
 * adapters, combined loss vs the best single adapter and the gain ratio) and
 * one card per adapter (interface, role, TX badge, antenna, driver, RSSI per
 * chain, packets, loss, FEC recoveries, verification).
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Antenna, Layers } from "lucide-react";
import {
  adapterLossPct,
  type DiversitySummary,
  type RadioAdapter,
} from "@/lib/api/ground-station-api";
import { Chip, LaneCard, StatRow, fmtNum, type ChipTone } from "./lane-ui";

const ROLE_TONE: Record<string, ChipTone> = {
  rxtx: "accent",
  rx: "success",
  tx: "warning",
  mesh: "muted",
};

const pct = (v: number | null) => (v === null ? fmtNum(null) : `${v.toFixed(2)} %`);

function AdapterCard({ adapter }: { adapter: RadioAdapter }) {
  const t = useTranslations("hardware.radio.adapters");
  const loss = adapterLossPct(adapter);
  return (
    <div className="rounded border border-border-default bg-bg-primary/40 p-3" aria-label={adapter.iface} role="group">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-sm font-semibold text-text-primary">{adapter.iface}</span>
        <Chip tone={adapter.role ? (ROLE_TONE[adapter.role] ?? "muted") : "muted"}>
          {adapter.role ? t(`role.${adapter.role}`) : t("role.unknown")}
        </Chip>
        {adapter.tx_active ? <Chip tone="warning">{t("txBadge")}</Chip> : null}
        {adapter.verified === true ? (
          <Chip tone="success">{t("verified")}</Chip>
        ) : adapter.verified === false ? (
          <Chip tone="warning">{t("unverified")}</Chip>
        ) : null}
      </div>
      <dl>
        <StatRow label={t("antenna")} value={adapter.antenna ?? t("notReported")} />
        <StatRow label={t("driver")} value={adapter.driver ?? t("notReported")} />
        {adapter.rssi_dbm.length === 0 ? (
          <StatRow label={t("rssi")} value={fmtNum(null)} />
        ) : (
          adapter.rssi_dbm.map((v, i) => (
            <StatRow
              key={i}
              label={t("rssiChain", { chain: String.fromCharCode(65 + i) })}
              value={`${fmtNum(v)} dBm`}
            />
          ))
        )}
        <StatRow label={t("packets")} value={fmtNum(adapter.packets)} />
        <StatRow label={t("lost")} value={pct(loss)} />
        <StatRow label={t("fecRec")} value={fmtNum(adapter.fec_rec)} />
      </dl>
    </div>
  );
}

interface RadioAdaptersViewProps {
  adapters: readonly RadioAdapter[];
  summary: DiversitySummary;
}

export function RadioAdaptersView({ adapters, summary }: RadioAdaptersViewProps) {
  const t = useTranslations("hardware.radio.adapters");
  return (
    <div className="flex flex-col gap-3">
      <LaneCard title={t("diversity.title")} icon={Layers}>
        <dl className="grid gap-x-6 sm:grid-cols-3">
          <StatRow label={t("diversity.rxAdapters")} value={fmtNum(summary.rxAdapters)} />
          <StatRow label={t("diversity.combined")} value={pct(summary.combinedLossPct)} />
          <StatRow label={t("diversity.best")} value={pct(summary.bestSingleLossPct)} />
        </dl>
        <p className="mt-2 text-xs text-text-secondary">
          {summary.gainRatio !== null
            ? t("diversity.gain", { ratio: summary.gainRatio.toFixed(1) })
            : t("diversity.gainNone")}
        </p>
      </LaneCard>
      <LaneCard title={t("title")} icon={Antenna}>
        <p className="mb-3 text-xs text-text-tertiary">{t("description")}</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {adapters.map((a) => (
            <AdapterCard key={a.iface} adapter={a} />
          ))}
        </div>
      </LaneCard>
    </div>
  );
}
