"use client";

/**
 * @module ground-station/lora/LoraGovernorMeters
 * @description One meter row per rule the active plan declares, in plan
 * order: duty cycle (used vs limit, airtime vs budget per window, sub-band),
 * dwell time (last frame vs limit per window), listen-before-talk (last RSSI
 * vs threshold, listen time, busy count) and maximum power (configured vs
 * limit). A rule kind this app does not know renders its scalar fields
 * generically. Below the meters: refusals by rule and the last refusal.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  LoraDutyCycleRule,
  LoraDwellTimeRule,
  LoraGovernorRule,
  LoraLbtRule,
  LoraMaxPowerRule,
  LoraStatus,
} from "@/lib/api/ground-station-api";
import { Chip, LaneCard, fmtNum } from "../lane-ui";
import { meterTone, type MeterTone } from "./lora-format";

const BAR_CLASS: Record<MeterTone, string> = {
  neutral: "bg-accent-primary",
  warning: "bg-status-warning",
  error: "bg-status-error",
};

const KNOWN_KINDS: Record<string, true> = {
  duty_cycle: true,
  dwell_time: true,
  lbt: true,
  max_power: true,
};

function Meter({
  value,
  limit,
  label,
  tone,
}: {
  value: unknown;
  limit: unknown;
  label: string;
  /** Overrides the fill-derived tone, for a rule where reaching the limit
   * is allowed (transmit power may sit exactly at the plan's cap). */
  tone?: MeterTone;
}) {
  const v = typeof value === "number" && Number.isFinite(value) ? value : null;
  const l = typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? limit : null;
  const fraction = v !== null && l !== null ? v / l : 0;
  return (
    <div
      className="h-1.5 w-full bg-bg-tertiary"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={l ?? 0}
      aria-valuenow={v ?? 0}
    >
      <div
        className={cn("h-full transition-all duration-300", BAR_CLASS[tone ?? meterTone(fraction)])}
        style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }}
      />
    </div>
  );
}

function RuleRow({ label, meter, detail, chip }: { label: string; meter?: ReactNode; detail: string; chip?: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-x-3 gap-y-1 border-b border-border-default py-2 last:border-b-0 sm:grid-cols-[minmax(0,12rem)_1fr_auto_auto]">
      <span className="truncate text-xs text-text-secondary">{label}</span>
      <div className="min-w-0">{meter}</div>
      <span className="font-mono text-[11px] tabular-nums text-text-primary">{detail}</span>
      <span className="justify-self-end">{chip}</span>
    </div>
  );
}

function RuleMeter({ rule, index }: { rule: LoraGovernorRule; index: number }) {
  const t = useTranslations("groundStationLanes.lora.governor");
  const okChip = (ok: unknown, bad: string) =>
    ok === false ? <Chip tone="error">{bad}</Chip> : ok === true ? <Chip tone="success">{t("ok")}</Chip> : null;
  if (!Object.hasOwn(KNOWN_KINDS, rule.kind)) {
    const fields = Object.entries(rule)
      .filter(([k, v]) => k !== "kind" && (typeof v === "number" || typeof v === "string" || typeof v === "boolean"))
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(" · ");
    return <RuleRow key={`${rule.kind}-${index}`} label={t("unknownKind", { kind: rule.kind })} detail={fields} />;
  }
  switch (rule.kind) {
    case "duty_cycle": {
      const r = rule as LoraDutyCycleRule;
      const label = r.sub_band ? `${t("kind.duty_cycle")} ${r.sub_band}` : t("kind.duty_cycle");
      return (
        <RuleRow
          key={`duty-${index}`}
          label={label}
          meter={<Meter value={r.used_pct} limit={r.limit_pct} label={label} />}
          detail={`${t("dutyAirtime", {
            airtime: fmtNum(r.airtime_ms_window / 1000, 1),
            budget: fmtNum(r.budget_ms_window / 1000, 1),
            window: fmtNum(r.window_s),
          })} · ${t("dutyUsed", { used: fmtNum(r.used_pct, 2), limit: fmtNum(r.limit_pct, 1) })}`}
          chip={r.exhausted ? <Chip tone="error">{t("exhausted")}</Chip> : <Chip tone="success">{t("ok")}</Chip>}
        />
      );
    }
    case "dwell_time": {
      const r = rule as LoraDwellTimeRule;
      const label = t("kind.dwell_time");
      return (
        <RuleRow
          key={`dwell-${index}`}
          label={label}
          meter={<Meter value={r.last_tx_ms} limit={r.limit_ms} label={label} />}
          detail={t("dwell", { last: fmtNum(r.last_tx_ms), limit: fmtNum(r.limit_ms), per: fmtNum(r.per_s) })}
          chip={okChip(r.ok, t("over"))}
        />
      );
    }
    case "lbt": {
      const r = rule as LoraLbtRule;
      const busy =
        typeof r.last_rssi_dbm === "number" && typeof r.threshold_dbm === "number"
          ? r.last_rssi_dbm > r.threshold_dbm
          : null;
      return (
        <RuleRow
          key={`lbt-${index}`}
          label={t("kind.lbt")}
          detail={`${t("lbt", {
            threshold: fmtNum(r.threshold_dbm),
            listen: fmtNum(r.listen_us),
            rssi: fmtNum(r.last_rssi_dbm),
          })} · ${t("busyCount", { count: fmtNum(r.busy_count) })}`}
          chip={busy === null ? null : <Chip tone={busy ? "warning" : "success"}>{busy ? t("busy") : t("clear")}</Chip>}
        />
      );
    }
    default: {
      const r = rule as LoraMaxPowerRule;
      const label = t("kind.max_power");
      return (
        <RuleRow
          key={`power-${index}`}
          label={label}
          meter={
            <Meter
              value={r.configured_mw}
              limit={r.limit_mw}
              label={label}
              tone={r.ok === false || r.configured_mw > r.limit_mw ? "error" : "neutral"}
            />
          }
          detail={t("power", { configured: fmtNum(r.configured_mw), limit: fmtNum(r.limit_mw) })}
          chip={okChip(r.ok, t("over"))}
        />
      );
    }
  }
}

interface LoraGovernorMetersProps {
  status: LoraStatus;
  now: number;
}

export function LoraGovernorMeters({ status, now }: LoraGovernorMetersProps) {
  const t = useTranslations("groundStationLanes.lora.governor");
  const tr = useTranslations("groundStationLanes.lora.refusals");
  const rules = Array.isArray(status.governor?.rules) ? status.governor.rules : [];
  const refusedByRule = Object.entries(status.tx?.refused_by_rule ?? {});
  const last = status.governor?.last_refusal ?? null;
  const ruleName = (rule: string) =>
    tr.has(`rule_name.${rule}`) ? tr(`rule_name.${rule}`) : rule;

  return (
    <LaneCard title={t("title")} icon={Gauge}>
      {rules.length === 0 ? (
        <p className="text-xs text-text-tertiary">{t("none")}</p>
      ) : (
        <div>{rules.map((rule, i) => <RuleMeter key={`${rule.kind}-${i}`} rule={rule} index={i} />)}</div>
      )}

      <div className="mt-3 border-t border-border-default pt-3">
        <h3 className="mb-2 text-xs font-semibold text-text-secondary">{tr("title")}</h3>
        {refusedByRule.length > 0 ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text-tertiary">
                <th className="py-1 font-normal">{tr("rule")}</th>
                <th className="py-1 text-right font-normal">{tr("count")}</th>
              </tr>
            </thead>
            <tbody>
              {refusedByRule.map(([rule, count]) => (
                <tr key={rule} className="border-t border-border-default">
                  <td className="py-1 text-text-secondary">{ruleName(rule)}</td>
                  <td
                    className={cn(
                      "py-1 text-right font-mono tabular-nums",
                      count > 0 ? "text-status-warning" : "text-text-primary",
                    )}
                  >
                    {fmtNum(count)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {status.tx ? (
          <p className="mt-2 font-mono text-[11px] text-text-tertiary">
            {tr("total", { frames: fmtNum(status.tx.frames), refused: fmtNum(status.tx.refused) })}
          </p>
        ) : null}
        <p className="mt-1 text-[11px] text-text-secondary">
          {tr("last")}:{" "}
          <span className="font-mono text-text-primary">
            {last
              ? tr("lastValue", {
                  rule: ruleName(last.rule),
                  age: `${fmtNum(Math.max(0, (now - last.at_ms) / 1000))} s`,
                })
              : tr("lastNone")}
          </span>
        </p>
      </div>
    </LaneCard>
  );
}
