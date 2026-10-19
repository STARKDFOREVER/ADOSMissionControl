"use client";

/**
 * @module ground-station/lora/LoraBeaconsTable
 * @description Position beacons the LoRa lane heard, newest first: node,
 * age, position, altitude, battery, flight mode, RSSI and SNR.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { MapPin } from "lucide-react";
import type { LoraBeacon } from "@/lib/api/ground-station-api";
import { LaneCard, fmtNum, EMPTY_VALUE } from "../lane-ui";

interface LoraBeaconsTableProps {
  beacons: readonly LoraBeacon[];
  now: number;
}

export function LoraBeaconsTable({ beacons, now }: LoraBeaconsTableProps) {
  const t = useTranslations("groundStationLanes.lora.beacons");
  return (
    <LaneCard title={t("title")} icon={MapPin}>
      {beacons.length === 0 ? (
        <p className="text-xs text-text-tertiary">{t("none")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-xs">
            <thead>
              <tr className="text-left text-text-tertiary">
                <th className="px-2 py-1 font-normal">{t("node")}</th>
                <th className="px-2 py-1 font-normal">{t("age")}</th>
                <th className="px-2 py-1 font-normal">{t("position")}</th>
                <th className="px-2 py-1 text-right font-normal">{t("alt")}</th>
                <th className="px-2 py-1 text-right font-normal">{t("battery")}</th>
                <th className="px-2 py-1 font-normal">{t("mode")}</th>
                <th className="px-2 py-1 text-right font-normal">{t("rssi")}</th>
                <th className="px-2 py-1 text-right font-normal">{t("snr")}</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums text-text-primary">
              {beacons.map((b) => (
                <tr key={`${b.node_id}-${b.received_at_ms}`} className="border-t border-border-default">
                  <td className="px-2 py-1">{t("nodeId", { id: b.node_id })}</td>
                  <td className="px-2 py-1">
                    {t("ageValue", { s: fmtNum(Math.max(0, (now - b.received_at_ms) / 1000)) })}
                  </td>
                  <td className="px-2 py-1">{`${fmtNum(b.lat_deg, 4)} ${fmtNum(b.lon_deg, 4)}`}</td>
                  <td className="px-2 py-1 text-right">{b.alt_m == null ? EMPTY_VALUE : `${fmtNum(b.alt_m)} m`}</td>
                  <td className="px-2 py-1 text-right">{b.battery_pct == null ? EMPTY_VALUE : `${fmtNum(b.battery_pct)} %`}</td>
                  <td className="px-2 py-1">{b.mode ?? EMPTY_VALUE}</td>
                  <td className="px-2 py-1 text-right">{fmtNum(b.rssi_dbm)}</td>
                  <td className="px-2 py-1 text-right">{fmtNum(b.snr_db, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </LaneCard>
  );
}
