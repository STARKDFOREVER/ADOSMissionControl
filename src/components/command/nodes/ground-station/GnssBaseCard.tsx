"use client";

/**
 * @module ground-station/GnssBaseCard
 * @description RTK base station card: live state (survey-in progress and
 * accuracy, or the fixed position) and the off / survey / fixed mode control.
 * Writes are disabled while the vehicle may be armed; the payload is built by
 * `gnssBaseBody` so only a complete, in-range body is ever sent.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Crosshair, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  gnssBaseBody,
  type GnssBase,
  type GnssBaseBody,
  type GnssBaseMode,
  type GnssReceiver,
} from "@/lib/api/ground-station-api";
import { Chip, LaneCard, StatRow, fmtNum, type ChipTone } from "./lane-ui";

const STATE_TONE: Record<GnssBase["state"], ChipTone> = {
  off: "muted",
  surveying: "accent",
  fixed: "success",
  failed: "error",
};

interface GnssBaseCardProps {
  base: GnssBase | null;
  /** Seeds the fixed-position form when the base has no position yet. */
  receiver: GnssReceiver | null;
  /** Non-null while writes are refused (vehicle may be armed). */
  writeLock: string | null;
  applying: boolean;
  onApply: (body: GnssBaseBody) => void;
}

const draftOf = (v: number | null | undefined, digits: number) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "";

export function GnssBaseCard({ base, receiver, writeLock, applying, onApply }: GnssBaseCardProps) {
  const t = useTranslations("groundStationLanes.gnss.base");
  const seed = base?.fixed ?? receiver;
  const [mode, setMode] = useState<GnssBaseMode>(base?.mode ?? "off");
  const [minDur, setMinDur] = useState(draftOf(base?.min_dur_s ?? 300, 0));
  const [accuracy, setAccuracy] = useState(draftOf(base?.target_accuracy_m ?? 2, 1));
  const [lat, setLat] = useState(draftOf(seed?.lat_deg, 7));
  const [lon, setLon] = useState(draftOf(seed?.lon_deg, 7));
  const [hEll, setHEll] = useState(draftOf(seed?.h_ellipsoid_m, 2));

  const body = gnssBaseBody({
    mode,
    minDurS: Number(minDur),
    accuracyM: Number(accuracy),
    latDeg: lat.trim() === "" ? NaN : Number(lat),
    lonDeg: lon.trim() === "" ? NaN : Number(lon),
    hEllipsoidM: hEll.trim() === "" ? NaN : Number(hEll),
  });

  const surveyPct =
    base?.elapsed_s != null && base.min_dur_s ? (base.elapsed_s / base.min_dur_s) * 100 : 0;

  return (
    <LaneCard
      title={t("title")}
      icon={Crosshair}
      trailing={base ? <Chip tone={STATE_TONE[base.state] ?? "muted"}>{t(`state.${base.state}`)}</Chip> : null}
    >
      {base ? (
        <dl>
          <StatRow label={t("mode")} value={t(`modeLabel.${base.mode}`)} />
          {base.state === "surveying" ? (
            <>
              <StatRow
                label={t("surveyTime")}
                value={t("surveyProgress", { elapsed: fmtNum(base.elapsed_s), min: fmtNum(base.min_dur_s) })}
              />
              <ProgressBar value={surveyPct} color="var(--alt-accent-primary)" label={t("surveyTime")} className="py-1" />
              <StatRow
                label={t("accuracyLabel")}
                value={t("accuracy", { accuracy: fmtNum(base.accuracy_m, 2), target: fmtNum(base.target_accuracy_m, 2) })}
              />
            </>
          ) : null}
          {base.fixed ? (
            <StatRow
              label={t("fixedAt")}
              value={`${base.fixed.lat_deg.toFixed(7)}, ${base.fixed.lon_deg.toFixed(7)} · ${base.fixed.h_ellipsoid_m.toFixed(2)} m`}
            />
          ) : null}
        </dl>
      ) : (
        <p className="text-xs text-text-tertiary">{t("none")}</p>
      )}

      <div className="mt-4 flex flex-col gap-3 border-t border-border-default pt-3">
        <Select
          label={t("modeControl")}
          value={mode}
          onChange={(v) => setMode(v as GnssBaseMode)}
          options={[
            { value: "off", label: t("modeLabel.off") },
            { value: "survey", label: t("modeLabel.survey") },
            { value: "fixed", label: t("modeLabel.fixed") },
          ]}
          disabled={writeLock !== null}
        />
        {mode === "survey" ? (
          <div className="grid grid-cols-2 gap-2">
            <Input label={t("minDur")} unit="s" type="number" min={1} value={minDur} onChange={(e) => setMinDur(e.target.value)} />
            <Input label={t("targetAccuracy")} unit="m" type="number" min={0.01} step={0.1} value={accuracy} onChange={(e) => setAccuracy(e.target.value)} />
          </div>
        ) : null}
        {mode === "fixed" ? (
          <div className="grid grid-cols-3 gap-2">
            <Input label={t("lat")} unit="°" type="number" step={0.0000001} value={lat} onChange={(e) => setLat(e.target.value)} />
            <Input label={t("lon")} unit="°" type="number" step={0.0000001} value={lon} onChange={(e) => setLon(e.target.value)} />
            <Input label={t("hEll")} unit="m" type="number" step={0.01} value={hEll} onChange={(e) => setHEll(e.target.value)} />
          </div>
        ) : null}
        {writeLock ? (
          <p className="flex items-start gap-1.5 text-[11px] text-status-warning">
            <Lock size={12} className="mt-px shrink-0" />
            {writeLock}
          </p>
        ) : body === null ? (
          <p className="text-[11px] text-text-tertiary">{t("invalid")}</p>
        ) : null}
        <div>
          <Button
            size="sm"
            loading={applying}
            disabled={writeLock !== null || body === null || applying}
            onClick={() => body && onApply(body)}
          >
            {mode === "survey" ? t("startSurvey") : t("apply")}
          </Button>
        </div>
      </div>
    </LaneCard>
  );
}
