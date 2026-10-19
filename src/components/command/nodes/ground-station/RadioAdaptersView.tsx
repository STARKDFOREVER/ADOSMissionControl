"use client";

/**
 * @module ground-station/RadioAdaptersView
 * @description Multi-adapter WFB view: a receive-diversity summary (receive
 * adapters, combined loss vs the best single adapter and the gain ratio) and
 * one card per adapter (interface, role, TX badge, antenna, driver, RSSI per
 * chain, packets, loss, FEC recoveries, verification).
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Antenna, Layers } from "lucide-react";
import {
  adapterLossPct,
  type DiversitySummary,
  type RadioAdapter,
} from "@/lib/api/ground-station-api";
import type { RingBuffer } from "@/lib/ring-buffer";
import { useAdapterRssiHistoryStore } from "@/stores/ground-station/adapter-rssi-history-store";
import { Chip, LaneCard, StatRow, fmtNum, type ChipTone } from "./lane-ui";
import { RssiSparkline } from "./RssiSparkline";

const ROLE_TONE: Record<string, ChipTone> = {
  rxtx: "accent",
  rx: "success",
  tx: "warning",
  mesh: "muted",
};

const pct = (v: number | null) => (v === null ? fmtNum(null) : `${v.toFixed(2)} %`);

interface AdapterCardProps {
  adapter: RadioAdapter;
  rings: RingBuffer<number>[] | undefined;
  rev: number;
}

function AdapterCard({ adapter, rings, rev }: AdapterCardProps) {
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
          adapter.rssi_dbm.map((v, i) => {
            const chainLabel = t("rssiChain", { chain: String.fromCharCode(65 + i) });
            return (
              <StatRow
                key={i}
                label={chainLabel}
                value={
                  <span className="inline-flex items-center gap-2">
                    <RssiSparkline ring={rings?.[i]} rev={rev} label={t("rssiHistory", { iface: adapter.iface, chain: chainLabel })} />
                    {`${fmtNum(v)} dBm`}
                  </span>
                }
              />
            );
          })
        )}
        <StatRow label={t("packets")} value={fmtNum(adapter.packets)} />
        {adapter.fec_rec === null && loss !== null ? (
          // FEC is per stream when several adapters receive it, so the
          // per-adapter loss is the agent's estimate.
          <StatRow label={t("lost")} value={<span title={t("lostEstimate")}>≈ {pct(loss)}</span>} />
        ) : (
          <StatRow label={t("lost")} value={pct(loss)} />
        )}
        <StatRow
          label={t("fecRec")}
          value={
            adapter.fec_rec === null ? (
              <span title={t("fecRecPerStream")}>—</span>
            ) : (
              fmtNum(adapter.fec_rec)
            )
          }
        />
      </dl>
    </div>
  );
}

interface RadioAdaptersViewProps {
  adapters: readonly RadioAdapter[];
  summary: DiversitySummary;
  /** Keys the RSSI history (the node the adapters belong to). */
  historyKey: string;
}

export function RadioAdaptersView({ adapters, summary, historyKey }: RadioAdaptersViewProps) {
  const t = useTranslations("hardware.radio.adapters");
  const record = useAdapterRssiHistoryStore((s) => s.record);
  const history = useAdapterRssiHistoryStore((s) => s.byNode[historyKey]);
  const rev = useAdapterRssiHistoryStore((s) => s.rev);
  // Each new adapters reading appends one sample per chain to its ring.
  useEffect(() => {
    record(historyKey, adapters);
  }, [record, historyKey, adapters]);
  return (
    <div className="flex flex-col gap-3">
      {/* Diversity needs two receive adapters; a TX or mesh second card is not diversity. */}
      {summary.rxAdapters >= 2 ? (
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
      ) : null}
      <LaneCard title={t("title")} icon={Antenna}>
        <p className="mb-3 text-xs text-text-tertiary">{t("description")}</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {adapters.map((a) => (
            <AdapterCard key={a.iface} adapter={a} rings={history?.[a.iface]} rev={rev} />
          ))}
        </div>
      </LaneCard>
    </div>
  );
}
