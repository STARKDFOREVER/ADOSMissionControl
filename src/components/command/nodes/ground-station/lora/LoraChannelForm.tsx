"use client";

/**
 * @module ground-station/lora/LoraChannelForm
 * @description Channel and power settings inside the active plan: frequency,
 * ERP and spreading factor. The agent rejects values outside the plan with
 * `E_LORA_OUT_OF_PLAN`; this form only checks that each field is a number.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LoraChannel, LoraUpdate } from "@/lib/api/ground-station-api";

interface LoraChannelFormProps {
  channel: LoraChannel | null;
  writeLock: string | null;
  applying: boolean;
  onApply: (body: LoraUpdate) => void;
}

const draft = (v: number | null | undefined) => (typeof v === "number" ? String(v) : "");

export function LoraChannelForm({ channel, writeLock, applying, onApply }: LoraChannelFormProps) {
  const t = useTranslations("groundStationLanes.lora.channel");
  const [freq, setFreq] = useState(draft(channel?.freq_mhz));
  const [erp, setErp] = useState(draft(channel?.erp_mw));
  const [sf, setSf] = useState(draft(channel?.sf));

  const freqN = Number(freq);
  const erpN = Number(erp);
  const sfN = Number(sf);
  const valid =
    freq.trim() !== "" && Number.isFinite(freqN) && freqN > 0 &&
    erp.trim() !== "" && Number.isFinite(erpN) && erpN > 0 &&
    Number.isInteger(sfN) && sfN >= 7 && sfN <= 12;

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border-default pt-3">
      <div className="grid grid-cols-3 gap-2">
        <Input label={t("freqLabel")} unit="MHz" type="number" step={0.001} value={freq} onChange={(e) => setFreq(e.target.value)} />
        <Input
          label={t("erpLabel")}
          unit="mW"
          type="number"
          min={1}
          max={channel?.max_erp_mw ?? undefined}
          value={erp}
          onChange={(e) => setErp(e.target.value)}
        />
        <Input label={t("sfLabel")} type="number" min={7} max={12} value={sf} onChange={(e) => setSf(e.target.value)} />
      </div>
      {writeLock ? (
        <p className="flex items-start gap-1.5 text-[11px] text-status-warning">
          <Lock size={12} className="mt-px shrink-0" />
          {writeLock}
        </p>
      ) : !valid ? (
        <p className="text-[11px] text-text-tertiary">{t("invalid")}</p>
      ) : null}
      <div>
        <Button
          size="sm"
          loading={applying}
          disabled={writeLock !== null || !valid || applying}
          onClick={() => onApply({ freq_mhz: freqN, erp_mw: erpN, sf: sfN })}
        >
          {t("apply")}
        </Button>
      </div>
    </div>
  );
}
