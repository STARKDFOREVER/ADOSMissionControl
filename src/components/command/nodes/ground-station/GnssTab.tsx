"use client";

/**
 * @module ground-station/GnssTab
 * @description Ground-station GNSS lane: receivers (fix, satellites, HDOP,
 * position, PPS lock), the RTK base (mode control, survey-in progress, fixed
 * position), the RTCM corrections it sends and the moving-baseline heading.
 * A node without the GNSS service reads "not fitted", never fabricated
 * numbers. Base writes are refused while the vehicle may be armed; in demo
 * they are inert and say so.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Compass, Satellite, Send } from "lucide-react";
import { PageIntro } from "@/components/hardware/PageIntro";
import { HintChip } from "@/components/hardware/HintChip";
import { CloudModeLimitedNotice } from "@/components/command/shared/CloudModeLimitedNotice";
import { useNodeDirectAgent } from "@/components/command/settings/use-node-direct-agent";
import { useToast } from "@/components/ui/toast";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { isDemoMode } from "@/lib/utils";
import {
  groundStationApiFromAgent,
  type GnssBaseBody,
  type GnssStatus,
} from "@/lib/api/ground-station-api";
import type { GnssFix } from "@/lib/api/agent/sensors-types";
import { AgentArmedRefusal } from "@/lib/agent/agent-client/transport";
import { useGnssStore } from "@/stores/ground-station/gnss-store";
import { useGroundStationPoll } from "./use-gs-poll";
import { GnssBaseCard } from "./GnssBaseCard";
import { Chip, LaneCard, NotFitted, StatRow, fmtNum, type ChipTone } from "./lane-ui";

const POLL_INTERVAL_MS = 2000;

const FIX_META: Record<GnssFix, { key: string; tone: ChipTone }> = {
  none: { key: "none", tone: "error" },
  "2d": { key: "fix2d", tone: "warning" },
  "3d": { key: "fix3d", tone: "success" },
  dgps: { key: "dgps", tone: "success" },
  rtk_float: { key: "rtkFloat", tone: "accent" },
  rtk_fixed: { key: "rtkFixed", tone: "success" },
};

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${n} B`;
}

export interface GnssLaneViewProps {
  gnss: GnssStatus;
  writeLock: string | null;
  applying: boolean;
  onApplyBase: (body: GnssBaseBody) => void;
}

/** The fitted-lane body, separated from the transport for tests. */
export function GnssLaneView({ gnss, writeLock, applying, onApplyBase }: GnssLaneViewProps) {
  const t = useTranslations("groundStationLanes.gnss");
  const base = gnss.base;
  const heading = gnss.heading;
  const rtcm = base?.rtcm_out ?? null;
  return (
    <div className="flex flex-col gap-3">
      <LaneCard title={t("receivers.title")} icon={Satellite}>
        {gnss.receivers.length === 0 ? (
          <p className="text-xs text-text-tertiary">{t("receivers.none")}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {gnss.receivers.map((r) => {
              const fix = FIX_META[r.fix] ?? { key: "none", tone: "muted" as ChipTone };
              return (
                <div key={r.id} className="rounded border border-border-default p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-text-primary">{r.id}</span>
                    {r.model ? <span className="text-[11px] text-text-tertiary">{r.model}</span> : null}
                    <Chip tone={fix.tone}>{t(`fix.${fix.key}`)}</Chip>
                    <Chip tone={r.pps_locked ? "success" : "muted"}>
                      {r.pps_locked ? t("receivers.ppsLocked") : t("receivers.ppsUnlocked")}
                    </Chip>
                  </div>
                  <dl>
                    <StatRow label={t("receivers.sats")} value={fmtNum(r.sats)} />
                    <StatRow label={t("receivers.hdop")} value={fmtNum(r.hdop, 1)} />
                    <StatRow
                      label={t("receivers.position")}
                      value={`${fmtNum(r.lat_deg, 6)}, ${fmtNum(r.lon_deg, 6)}`}
                    />
                    <StatRow label={t("receivers.hEll")} value={`${fmtNum(r.h_ellipsoid_m, 1)} m`} />
                    <StatRow label={t("receivers.hMsl")} value={`${fmtNum(r.h_msl_m, 1)} m`} />
                  </dl>
                </div>
              );
            })}
          </div>
        )}
      </LaneCard>

      <div className="grid gap-3 md:grid-cols-2">
        <GnssBaseCard
          base={base}
          receiver={gnss.receivers[0] ?? null}
          writeLock={writeLock}
          applying={applying}
          onApply={onApplyBase}
        />
        <LaneCard title={t("corrections.title")} icon={Send}>
          {rtcm && (rtcm.targets > 0 || rtcm.msgs_per_s > 0) ? (
            <dl>
              <StatRow
                label={t("corrections.msgsPerS")}
                value={t("corrections.msgsPerSValue", { rate: fmtNum(rtcm.msgs_per_s, 1) })}
              />
              <StatRow label={t("corrections.bytes")} value={formatBytes(rtcm.bytes_total)} />
              <StatRow label={t("corrections.targets")} value={fmtNum(rtcm.targets)} />
            </dl>
          ) : (
            <p className="text-xs text-text-tertiary">{t("corrections.none")}</p>
          )}
        </LaneCard>
      </div>

      <LaneCard title={t("heading.title")} icon={Compass}>
        {heading?.available ? (
          <dl className="grid gap-x-6 sm:grid-cols-3">
            <StatRow label={t("heading.deg")} value={`${fmtNum(heading.deg, 1)}°`} />
            <StatRow label={t("heading.accuracy")} value={`${fmtNum(heading.accuracy_deg, 1)}°`} />
            <StatRow label={t("heading.baseline")} value={`${fmtNum(heading.baseline_m, 2)} m`} />
          </dl>
        ) : (
          <p className="text-xs text-text-tertiary">{t("heading.notAvailable")}</p>
        )}
      </LaneCard>
    </div>
  );
}

export interface GnssTabProps {
  /** The node this tab is rendered for. */
  nodeDeviceId: string | null;
}

export function GnssTab({ nodeDeviceId }: GnssTabProps) {
  const t = useTranslations("groundStationLanes");
  const direct = useNodeDirectAgent(nodeDeviceId);
  const agentUrl = direct?.agentUrl ?? null;
  const apiKey = direct?.apiKey ?? null;
  // In demo the client is null and the seeded slice carries a null origin.
  const target = groundStationApiFromAgent(agentUrl, apiKey)?.baseUrl ?? null;
  const owned = useGnssStore((s) => s.gnssFor === target);
  const gnss = useGnssStore((s) => s.gnss);
  const error = useGnssStore((s) => s.error);
  const applying = useGnssStore((s) => s.applying);
  const load = useGnssStore((s) => s.load);
  const applyBase = useGnssStore((s) => s.applyBase);
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  const { toast } = useToast();

  useGroundStationPoll(agentUrl, apiKey, POLL_INTERVAL_MS, load);

  const onApplyBase = async (body: GnssBaseBody) => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) {
      if (isDemoMode()) toast(t("demoReadOnly"), "info");
      return;
    }
    try {
      const res = await applyBase(api, body);
      if (res) toast(t("gnss.base.applied"), "success");
      else toast(useGnssStore.getState().error ?? t("gnss.base.invalid"), "error");
    } catch (err) {
      if (err instanceof AgentArmedRefusal) toast(t("gnss.base.armedRefused"), "warning");
      else throw err;
    }
  };

  const shown = owned ? gnss : null;
  let body: ReactNode;
  if (direct === null) body = <CloudModeLimitedNotice feature="gnss" />;
  else if (!shown) {
    body = (
      <p className="text-xs text-text-tertiary">
        {owned && error ? t("gnss.error", { message: error }) : t("gnss.loading")}
      </p>
    );
  } else if (!shown.present) {
    body = <NotFitted icon={Satellite} title={t("gnss.notFitted.title")} body={t("gnss.notFitted.body")} />;
  } else {
    body = (
      <GnssLaneView
        gnss={shown}
        writeLock={isHardBlocked ? hardBlockMessage : null}
        applying={applying}
        onApplyBase={(b) => void onApplyBase(b)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <PageIntro
        title={t("gnss.title")}
        description={t("gnss.description")}
        trailing={<HintChip>{t("gnss.hint")}</HintChip>}
      />
      {body}
    </div>
  );
}
