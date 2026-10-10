"use client";

/**
 * @module hardware/radio/TxPowerCard
 * @description TX power slider section. The slider itself lives in the
 * shared TxPowerSlider component; this card wraps it with the heading,
 * the per-driver hard-cap label and the PHY-measured readback.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { TxPowerSlider } from "@/components/hardware/TxPowerSlider";
import type { SetTxPowerResult } from "@/lib/api/ground-station/types";

export interface TxPowerCardProps {
  txPowerDbm: number | null;
  /** TX power measured back from the PHY; null when not measured. */
  txPowerReadbackDbm: number | null;
  txPowerMaxDbm: number;
  hostname: string | null;
  onApply: (dbm: number) => Promise<SetTxPowerResult>;
}

export function TxPowerCard({
  txPowerDbm,
  txPowerReadbackDbm,
  txPowerMaxDbm,
  hostname,
  onApply,
}: TxPowerCardProps) {
  const t = useTranslations("hardware.radio");
  const initialSliderValue = txPowerDbm ?? 5;
  const safeMax = Math.max(1, txPowerMaxDbm);
  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <h3 className="mb-1 text-sm font-semibold text-text-primary">
        {t("txPower")}
      </h3>
      <p className="mb-1 text-xs text-text-tertiary">
        {t("txPowerHardCap", { max: safeMax })}
      </p>
      <p className="mb-4 text-xs text-text-tertiary" data-testid="tx-power-readback">
        {t("txPowerMeasured", {
          value: txPowerReadbackDbm != null ? `${txPowerReadbackDbm} dBm` : "—",
        })}
      </p>
      <TxPowerSlider
        currentDbm={txPowerDbm}
        maxDbm={safeMax}
        initialValue={initialSliderValue}
        confirmHostname={hostname}
        onApply={onApply}
      />
    </section>
  );
}
