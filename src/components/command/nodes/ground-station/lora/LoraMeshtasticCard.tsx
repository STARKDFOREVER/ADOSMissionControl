"use client";

/**
 * @module ground-station/lora/LoraMeshtasticCard
 * @description Receive counters and the Meshtastic bridge state of the LoRa
 * lane.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Network, Radio } from "lucide-react";
import type { LoraStatus } from "@/lib/api/ground-station-api";
import { Chip, LaneCard, StatRow, fmtNum, EMPTY_VALUE } from "../lane-ui";

export function LoraMeshtasticCard({ status }: { status: LoraStatus }) {
  const t = useTranslations("groundStationLanes.lora");
  const mesh = status.meshtastic;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <LaneCard title={t("rx.title")} icon={Radio}>
        <dl>
          <StatRow label={t("rx.frames")} value={fmtNum(status.rx?.frames)} />
          <StatRow
            label={t("rx.crc")}
            value={fmtNum(status.rx?.crc_errors)}
            valueClass={status.rx && status.rx.crc_errors > 0 ? "text-status-warning" : undefined}
          />
        </dl>
      </LaneCard>
      <LaneCard
        title={t("meshtastic.title")}
        icon={Network}
        trailing={
          !mesh?.enabled ? (
            <Chip tone="muted">{t("meshtastic.disabled")}</Chip>
          ) : mesh.connected ? (
            <Chip tone="success">{t("meshtastic.connected")}</Chip>
          ) : (
            <Chip tone="warning">{t("meshtastic.disconnected")}</Chip>
          )
        }
      >
        <dl>
          <StatRow label={t("meshtastic.port")} value={mesh?.port ?? EMPTY_VALUE} />
          <StatRow label={t("meshtastic.preset")} value={mesh?.region_preset ?? EMPTY_VALUE} />
        </dl>
      </LaneCard>
    </div>
  );
}
