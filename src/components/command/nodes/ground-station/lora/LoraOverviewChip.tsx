"use client";

/**
 * @module ground-station/lora/LoraOverviewChip
 * @description One-glance LoRa governor state for the ground-station
 * overview: `LoRa IN 0.4 %` while transmit is allowed, `LoRa paused 07:42`
 * while a waiting rule holds it (counting down locally between polls), and
 * `LoRa blocked: <reason>` when no amount of waiting clears it. Renders
 * nothing unless the shown node's LoRa lane is read and present.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { RadioTower } from "lucide-react";
import {
  groundStationApiFromAgent,
  type LoraDutyCycleRule,
  type LoraStatus,
} from "@/lib/api/ground-station-api";
import { useClockTick } from "@/lib/agent/freshness";
import { useClockStore } from "@/stores/clock-store";
import { useLoraStore } from "@/stores/ground-station/lora-store";
import { Chip } from "../lane-ui";
import { formatCountdown, loraTxState, remainingMs } from "./lora-format";

/** Highest duty use across the plan's duty-cycle sub-bands, or null. */
function dutyUsedPct(status: LoraStatus): number | null {
  let max: number | null = null;
  for (const rule of status.governor?.rules ?? []) {
    if (rule.kind !== "duty_cycle") continue;
    const used = (rule as LoraDutyCycleRule).used_pct;
    if (typeof used === "number" && (max === null || used > max)) max = used;
  }
  return max;
}

interface LoraOverviewChipProps {
  status: LoraStatus;
  fetchedAt: number | null;
  now: number;
}

export function LoraOverviewChip({ status, fetchedAt, now }: LoraOverviewChipProps) {
  const t = useTranslations("groundStationLanes.lora.overview");
  if (!status.present) return null;
  const code = status.region?.code ?? null;
  let tone: "success" | "warning" | "error";
  let text: string;
  const state = loraTxState(status);
  if (state === "allowed") {
    const used = dutyUsedPct(status);
    tone = "success";
    text = used === null ? t("ok", { code: code ?? "" }) : t("duty", { code: code ?? "", used: used.toFixed(1) });
  } else {
    const reason = status.blocked_reason ?? "region_unset";
    if (state === "paused") {
      tone = "warning";
      text = t("paused", {
        time: formatCountdown(remainingMs(status.governor?.next_tx_allowed_ms ?? 0, fetchedAt, now)),
      });
    } else {
      tone = "error";
      text = t.has(`reason.${reason}`) ? t("blocked", { reason: t(`reason.${reason}`) }) : t("blocked", { reason });
    }
  }
  return (
    <span role="status" aria-label={text}>
      <Chip tone={tone}>
        <RadioTower size={11} />
        {text}
      </Chip>
    </span>
  );
}

/** The chip for the node `agentUrl` serves, from the LoRa store; nothing
 * until that node's lane has been read (a slice read from another node, or
 * none at all, never renders here). */
export function GroundStationLoraChip({ agentUrl, apiKey }: { agentUrl: string | null; apiKey: string | null }) {
  // In demo the client is null and the seeded slice carries a null origin.
  const target = groundStationApiFromAgent(agentUrl, apiKey)?.baseUrl ?? null;
  const status = useLoraStore((s) => (s.loraFor === target ? s.status : null));
  const fetchedAt = useLoraStore((s) => s.fetchedAt);
  useClockTick();
  const now = useClockStore((s) => s.now);
  if (!status) return null;
  return <LoraOverviewChip status={status} fetchedAt={fetchedAt} now={now} />;
}