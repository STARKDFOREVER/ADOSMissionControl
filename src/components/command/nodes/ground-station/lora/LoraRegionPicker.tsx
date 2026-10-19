"use client";

/**
 * @module ground-station/lora/LoraRegionPicker
 * @description Region picker over the agent's compiled region table: each
 * row shows its plan, band, declared rules and whether the fitted module can
 * meet it, plus "follow country setting" (`region: null`). Applying asks for
 * confirmation naming the old and new region and is locked while the vehicle
 * may be armed (the agent also refuses with `E_ARMED`).
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, CircleHelp, Lock, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import type { LoraRegion, LoraRegionPlan } from "@/lib/api/ground-station-api";

const FOLLOW = "__follow__";

interface LoraRegionPickerProps {
  open: boolean;
  onClose: () => void;
  regions: LoraRegionPlan[] | null;
  current: LoraRegion | null;
  writeLock: string | null;
  applying: boolean;
  onApply: (region: string | null) => void;
}

export function LoraRegionPicker({ open, onClose, regions, current, writeLock, applying, onApply }: LoraRegionPickerProps) {
  const t = useTranslations("groundStationLanes.lora.picker");
  const initial = current && current.source === "lora.region" ? current.code : FOLLOW;
  const [selected, setSelected] = useState(initial);
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = regions ?? [];
    if (!q) return list;
    return list.filter(
      (r) => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.plan_id.toLowerCase().includes(q),
    );
  }, [regions, query]);

  const selectedPlan = regions?.find((x) => x.code === selected);
  const toLabel =
    selected === FOLLOW
      ? t("followLabel")
      : selectedPlan
        ? `${selectedPlan.code} (${selectedPlan.plan_id})`
        : selected;
  const fromLabel = current ? `${current.code} (${current.plan_id})` : t("noneLabel");

  const close = () => {
    setConfirming(false);
    setSelected(initial);
    onClose();
  };

  return (
    <>
      <Modal
        open={open && !confirming}
        onClose={close}
        title={t("title")}
        size="md"
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            {writeLock ? (
              <span className="flex items-center gap-1.5 text-[11px] text-status-warning">
                <Lock size={12} />
                {t("armed")}
              </span>
            ) : (
              <span className="text-[11px] text-text-tertiary">{t("responsibility")}</span>
            )}
            <Button
              size="sm"
              loading={applying}
              disabled={writeLock !== null || applying || selected === initial}
              onClick={() => setConfirming(true)}
            >
              {t("apply")}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3" role="radiogroup" aria-label={t("title")}>
          <Input aria-label={t("search")} placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="flex cursor-pointer items-center gap-2 rounded border border-border-default px-3 py-2 text-xs">
            <input type="radio" name="lora-region" checked={selected === FOLLOW} onChange={() => setSelected(FOLLOW)} />
            <span className="text-text-primary">{t("follow")}</span>
          </label>
          {regions === null ? (
            <p className="text-xs text-text-tertiary">{t("loading")}</p>
          ) : regions.length === 0 ? (
            <p className="text-xs text-text-tertiary">{t("empty")}</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {rows.map((r) => (
                <label
                  key={r.code}
                  className={cn(
                    "grid cursor-pointer grid-cols-[auto_3rem_1fr_auto] items-center gap-2 border-b border-border-default px-2 py-1.5 text-xs last:border-b-0 sm:grid-cols-[auto_3rem_1fr_7rem_6rem_1fr_auto]",
                    selected === r.code && "bg-bg-tertiary",
                  )}
                >
                  <input type="radio" name="lora-region" checked={selected === r.code} onChange={() => setSelected(r.code)} />
                  <span className="font-mono font-semibold text-text-primary">{r.code}</span>
                  <span className="truncate text-text-secondary">{r.name}</span>
                  <span className="hidden font-mono text-text-tertiary sm:inline">{r.plan_id}</span>
                  <span className="hidden font-mono text-text-tertiary sm:inline">
                    {r.band_mhz[0]}–{r.band_mhz[1]}
                  </span>
                  <span className="hidden truncate text-text-tertiary sm:inline">
                    {r.rules.length > 0 ? r.rules.join(", ") : t("rulesNotVerified")}
                  </span>
                  {r.supported_by_module === null ? (
                    <span title={t("moduleUnknown")} className="text-text-tertiary">
                      <CircleHelp size={14} aria-label={t("moduleUnknown")} />
                    </span>
                  ) : r.supported_by_module ? (
                    <span title={t("moduleOk")} className="text-status-success">
                      <Check size={14} aria-label={t("moduleOk")} />
                    </span>
                  ) : (
                    <span title={t("moduleNo")} className="flex items-center gap-0.5 text-status-warning">
                      <X size={14} aria-label={t("moduleNo")} />
                      {t("moduleNoShort")}
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={open && confirming}
        title={t("confirmTitle")}
        message={t("confirmBody", { from: fromLabel, to: toLabel })}
        confirmLabel={t("apply")}
        confirmDisabled={writeLock !== null}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onApply(selected === FOLLOW ? null : selected);
          onClose();
        }}
      />
    </>
  );
}
