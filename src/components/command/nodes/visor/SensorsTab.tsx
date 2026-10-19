"use client";

/**
 * @module visor/SensorsTab
 * @description The rig's sensors as the node reports them live: one row per
 * rig sensor with its rate against the rate the rig expects, the age of its
 * last sample, its sync sigma and the source it arrives through; the sensor
 * hub and flight controller behind them; and the GNSS fix when a receiver is
 * fitted. A node without the sensor service says so instead of showing an
 * empty table.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { PageIntro } from "@/components/hardware/PageIntro";
import { HintChip } from "@/components/hardware/HintChip";
import { CloudModeLimitedNotice } from "@/components/command/shared/CloudModeLimitedNotice";
import type { SensorsStatus } from "@/lib/api/agent/sensors";
import { cn } from "@/lib/utils";
import { useNodeSensors } from "./use-node-sensors";
import { LEVEL_TEXT, formatHz, gnssWithoutFix, rateLevel, sigmaMs } from "./sensor-format";
import { ReadingCard, ReadingEmpty, ReadingRow } from "./reading-card";

export interface SensorsTabProps {
  nodeDeviceId: string | null;
}

export function SensorsTab({ nodeDeviceId }: SensorsTabProps) {
  const t = useTranslations("visor.sensors");
  const { reachable, readings, error } = useNodeSensors(nodeDeviceId);
  const sensors = readings?.sensors ?? null;
  const clockSigma = readings?.clock?.present ? sigmaMs(readings.clock.sigma_ns) : null;

  return (
    <div className="flex flex-col gap-3 p-4">
      <PageIntro
        title={t("title")}
        description={t("description")}
        trailing={clockSigma !== null ? <HintChip>{t("clockSigma", { ms: clockSigma })}</HintChip> : undefined}
      />
      {!reachable ? (
        <CloudModeLimitedNotice feature="sensors" />
      ) : sensors === null ? (
        <p className="text-sm text-text-tertiary">{error ? t(`readFailed.${error}`) : t("loading")}</p>
      ) : !sensors.present ? (
        <ReadingEmpty title={t("notFitted")} body={t("notFittedBody")} />
      ) : (
        <>
          <SourcesRow sensors={sensors} />
          <SensorTable sensors={sensors} />
          <GnssLine sensors={sensors} />
        </>
      )}
    </div>
  );
}

function SourcesRow({ sensors }: { sensors: SensorsStatus }) {
  const t = useTranslations("visor.sensors");
  const { hub, fc } = sensors;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <ReadingCard title={t("rig")}>
        <ReadingRow label={t("rigId")} value={sensors.rig_id ?? t("none")} />
        <ReadingRow label={t("calibVersion")} value={sensors.calib_version ?? t("uncalibrated")} />
      </ReadingCard>
      <ReadingCard title={t("hub")}>
        {hub === null ? (
          <p className="text-xs text-text-tertiary">{t("hubNone")}</p>
        ) : (
          <>
            <ReadingRow label={t("link")} value={hub.connected ? t("connected") : t("disconnected")} level={hub.connected ? "ok" : "bad"} />
            <ReadingRow label={t("firmware")} value={hub.fw} />
            <ReadingRow label={t("board")} value={hub.board} />
            <ReadingRow label={t("transport")} value={hub.transport} />
            <ReadingRow
              label={t("errors")}
              value={t("errorCounts", { crc: hub.crc_errors, dropped: hub.dropped })}
              level={hub.crc_errors + hub.dropped > 0 ? "warn" : "ok"}
            />
          </>
        )}
      </ReadingCard>
      <ReadingCard title={t("fc")}>
        {fc === null ? (
          <p className="text-xs text-text-tertiary">{t("fcNone")}</p>
        ) : (
          <>
            <ReadingRow label={t("link")} value={fc.connected ? t("connected") : t("disconnected")} level={fc.connected ? "ok" : "bad"} />
            <ReadingRow label={t("autopilot")} value={fc.autopilot} />
            <ReadingRow label={t("highresImu")} value={fc.highres_imu ? t("yes") : t("no")} />
          </>
        )}
      </ReadingCard>
    </div>
  );
}

function SensorTable({ sensors }: { sensors: SensorsStatus }) {
  const t = useTranslations("visor.sensors");
  if (sensors.sensors.length === 0) {
    return <ReadingEmpty title={t("noSensors")} body={t("noSensorsBody")} />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border-default bg-bg-secondary">
      <table className="w-full text-xs">
        <thead className="text-left text-text-tertiary">
          <tr>
            {(["id", "kind", "role", "rate", "age", "sigma", "source"] as const).map((col) => (
              <th key={col} className="px-3 py-2 font-medium">
                {t(`col.${col}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {sensors.sensors.map((s) => {
            const sigma = sigmaMs(s.sigma_ns);
            return (
              <tr key={s.id} className="border-t border-border-default">
                <td className="px-3 py-1.5 text-text-primary">{s.id}</td>
                <td className="px-3 py-1.5 text-text-secondary">{s.kind}</td>
                <td className="px-3 py-1.5 text-text-secondary">{s.role || "-"}</td>
                {gnssWithoutFix(s, sensors.gnss) ? (
                  <td className={cn("px-3 py-1.5", LEVEL_TEXT.idle)}>{t("noFix")}</td>
                ) : (
                  <td className={cn("px-3 py-1.5", LEVEL_TEXT[rateLevel(s.rate_hz, s.expected_hz)])}>
                    {formatHz(s.rate_hz)}
                    {s.expected_hz !== null ? (
                      <span className="text-text-tertiary"> ({formatHz(s.expected_hz)})</span>
                    ) : null}
                  </td>
                )}
                <td className="px-3 py-1.5 text-text-secondary">
                  {s.age_ms === null ? "-" : t("ageMs", { ms: Math.round(s.age_ms) })}
                </td>
                <td className="px-3 py-1.5 text-text-secondary">{sigma ?? "-"}</td>
                <td className="px-3 py-1.5 text-text-secondary">{s.source}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GnssLine({ sensors }: { sensors: SensorsStatus }) {
  const t = useTranslations("visor.sensors");
  const g = sensors.gnss;
  return (
    <p className="text-xs text-text-secondary">
      {g === null
        ? t("gnssNone")
        : t("gnssLine", { fix: g.fix, sats: g.sats, hdop: g.hdop.toFixed(1), rtk: g.rtk })}
    </p>
  );
}
