"use client";

/**
 * @module visor/VisorReadingCards
 * @description The Visor Overview's reading cards: battery, capture storage,
 * session clock, rig summary and the last capture session. Each card states
 * plainly when its service is not fitted or not yet read; none invents a
 * value.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import type { BatteryHealth } from "@/lib/agent/schemas/battery";
import type {
  CaptureSessionSummary,
  ClockStatus,
  SensorsStatus,
  StorageStatus,
} from "@/lib/api/agent/sensors";
import { formatBytes } from "@/lib/tile-math";
import { formatDurationSeconds } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import { ReadingCard, ReadingRow } from "./reading-card";
import { LEVEL_TEXT, formatHz, rateLevel, sigmaMs } from "./sensor-format";

/** `undefined` = not read yet; the card says so rather than "absent". */
type Reading<T> = T | null | undefined;

function Muted({ children }: { children: string }) {
  return <p className="text-xs text-text-tertiary">{children}</p>;
}

export function BatteryCard({ battery }: { battery: Reading<BatteryHealth> }) {
  const t = useTranslations("visor.overview");
  const pack = battery?.enabled ? battery.packs[0] : undefined;
  return (
    <ReadingCard title={t("battery")}>
      {battery === undefined || battery === null ? (
        <Muted>{t("notRead")}</Muted>
      ) : !pack ? (
        <Muted>{t("batteryNone")}</Muted>
      ) : (
        <>
          <ReadingRow
            label={t("charge")}
            value={pack.remaining_pct === null ? "-" : `${Math.round(pack.remaining_pct)} %`}
          />
          <ReadingRow
            label={t("voltage")}
            value={pack.voltage_v === null ? "-" : `${pack.voltage_v.toFixed(1)} V`}
          />
          <ReadingRow
            label={t("toReserve")}
            value={
              pack.prediction.eta_s === null || battery.stale || pack.stale
                ? "-"
                : formatDurationSeconds(pack.prediction.eta_s)
            }
          />
        </>
      )}
    </ReadingCard>
  );
}

export function StorageCard({ storage }: { storage: Reading<StorageStatus> }) {
  const t = useTranslations("visor.overview");
  const vol = storage?.volumes.find((v) => v.is_capture) ?? storage?.volumes[0];
  const cap = storage?.capture ?? null;
  const level = cap ? ({ ok: "ok", near_full: "warn", full: "bad" } as const)[cap.state] : undefined;
  return (
    <ReadingCard
      title={t("storage")}
      trailing={
        cap && level ? (
          <span className={cn("text-[11px] font-medium", LEVEL_TEXT[level])}>
            {t(`storageState.${cap.state}`)}
          </span>
        ) : undefined
      }
    >
      {!storage ? (
        <Muted>{t("notRead")}</Muted>
      ) : !storage.present || !vol ? (
        <Muted>{t("storageNone")}</Muted>
      ) : (
        <>
          <ReadingRow
            label={t("free")}
            value={t("freeOf", { free: formatBytes(vol.free_bytes), total: formatBytes(vol.total_bytes) })}
          />
          {cap && (
            <>
              <ReadingRow label={t("budget")} value={`${cap.budget_pct} %`} />
              <ReadingRow
                label={t("sessions")}
                value={t("sessionsUploaded", { uploaded: cap.uploaded, total: cap.sessions })}
              />
            </>
          )}
        </>
      )}
    </ReadingCard>
  );
}

export function ClockCard({ clock }: { clock: Reading<ClockStatus> }) {
  const t = useTranslations("visor.overview");
  const sigma = clock?.present ? sigmaMs(clock.sigma_ns) : null;
  return (
    <ReadingCard
      title={t("clock")}
      trailing={
        clock?.present ? (
          <span
            className={cn(
              "text-[11px] font-medium",
              clock.locked ? "text-status-success" : "text-status-warning",
            )}
          >
            {clock.locked ? t("locked") : t("unlocked")}
          </span>
        ) : undefined
      }
    >
      {!clock ? (
        <Muted>{t("notRead")}</Muted>
      ) : !clock.present ? (
        <Muted>{t("clockNone")}</Muted>
      ) : (
        <>
          <ReadingRow label={t("timebase")} value={clock.timebase ?? "-"} />
          <ReadingRow label={t("sigma")} value={sigma === null ? t("unmeasured") : `${sigma} ms`} />
          <div className="flex flex-wrap gap-1 pt-1">
            {clock.sources.map((s) => (
              <span
                key={s.id}
                className={cn(
                  "rounded border border-border-default px-1.5 py-0.5 font-mono text-[10px]",
                  s.locked ? "text-status-success" : "text-text-tertiary",
                )}
              >
                {s.id}
              </span>
            ))}
          </div>
        </>
      )}
    </ReadingCard>
  );
}

export function RigCard({ sensors }: { sensors: Reading<SensorsStatus> }) {
  const t = useTranslations("visor.overview");
  return (
    <ReadingCard
      title={t("rig")}
      trailing={
        sensors?.present ? (
          <span className="font-mono text-[11px] text-text-tertiary">
            {sensors.rig_id ?? "-"} · {sensors.calib_version ?? t("uncalibrated")}
          </span>
        ) : undefined
      }
    >
      {!sensors ? (
        <Muted>{t("notRead")}</Muted>
      ) : !sensors.present ? (
        <Muted>{t("rigNone")}</Muted>
      ) : sensors.sensors.length === 0 ? (
        <Muted>{t("rigEmpty")}</Muted>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
          {sensors.sensors.map((s) => (
            <span key={s.id} className="text-text-secondary">
              {s.id} <span className="text-text-tertiary">{s.role}</span>{" "}
              <span className={LEVEL_TEXT[rateLevel(s.rate_hz, s.expected_hz)]}>
                {formatHz(s.rate_hz)} Hz
              </span>
            </span>
          ))}
        </div>
      )}
    </ReadingCard>
  );
}

export function LastSessionCard({
  sessions,
}: {
  sessions: Reading<CaptureSessionSummary[]>;
}) {
  const t = useTranslations("visor.overview");
  const last = sessions?.[0];
  return (
    <ReadingCard title={t("lastSession")}>
      {sessions === undefined ? (
        <Muted>{t("notRead")}</Muted>
      ) : sessions === null ? (
        <Muted>{t("captureNotInstalled")}</Muted>
      ) : !last ? (
        <Muted>{t("noSessions")}</Muted>
      ) : (
        <>
          <p className="truncate font-mono text-xs text-text-primary">{last.session_id}</p>
          <ReadingRow
            label={t("length")}
            value={`${formatDurationSeconds(last.duration_s)} · ${formatBytes(last.size_bytes)}`}
          />
          <ReadingRow
            label={t("rooms")}
            value={t("roomsFloors", { rooms: last.rooms.length, floors: last.floors.join(", ") || "-" })}
          />
          <ReadingRow
            label={t("upload")}
            value={t(`uploadState.${last.upload.state}`)}
            level={last.upload.state === "failed" ? "bad" : last.uploaded ? "ok" : undefined}
          />
        </>
      )}
    </ReadingCard>
  );
}
