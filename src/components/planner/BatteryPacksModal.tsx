/**
 * @module BatteryPacksModal
 * @description Editor for the battery packs the energy estimate flies with:
 * one row per pack (name, usable capacity, cruise and hover power, reserve),
 * with add, rename and delete. Every edit lands in the settings store as it is
 * committed, so the Energy tab follows live. The default pack is the fallback
 * the estimate always has, so it cannot be deleted.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { useSyncedDraft } from "@/hooks/use-synced-draft";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ScrubNumberField } from "@/components/ui/scrub-number-field";
import { cn, randomId } from "@/lib/utils";
import type { BatteryProfile } from "@/lib/energy/battery-split";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_BATTERY_PROFILE, DEFAULT_BATTERY_PROFILE_ID } from "@/stores/settings/planning-slice";

interface BatteryPacksModalProps {
  open: boolean;
  onClose: () => void;
}

/** Name, capacity, cruise, hover, reserve, delete. */
const GRID = "grid grid-cols-[minmax(0,1fr)_88px_80px_80px_72px_28px] items-center gap-2";

export function BatteryPacksModal({ open, onClose }: BatteryPacksModalProps) {
  const t = useTranslations("planner.energy.packs");
  const packs = useSettingsStore((s) => s.batteryProfiles);
  const addBatteryProfile = useSettingsStore((s) => s.addBatteryProfile);
  const selectBatteryProfile = useSettingsStore((s) => s.selectBatteryProfile);

  const addPack = () => {
    // A new pack starts from the default figures under a fresh, numbered name.
    const pack: BatteryProfile = {
      ...DEFAULT_BATTERY_PROFILE,
      id: randomId(),
      name: t("newName", { n: packs.length + 1 }),
    };
    addBatteryProfile(pack);
    selectBatteryProfile(pack.id);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("title")}
      size="md"
      footer={
        <div className="flex w-full items-center justify-between">
          <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={addPack}>
            {t("add")}
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            {t("done")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-1 text-xs">
        <div className={cn(GRID, "text-[11px] font-semibold text-text-tertiary")}>
          <span>{t("name")}</span>
          <span>{t("capacity")}</span>
          <span>{t("cruise")}</span>
          <span>{t("hover")}</span>
          <span>{t("reserve")}</span>
          <span />
        </div>
        {packs.map((pack) => (
          <PackRow key={pack.id} pack={pack} />
        ))}
        <p className="mt-2 text-[11px] leading-snug text-text-tertiary">{t("hint")}</p>
      </div>
    </Modal>
  );
}

function PackRow({ pack }: { pack: BatteryProfile }) {
  const t = useTranslations("planner.energy.packs");
  const updateBatteryProfile = useSettingsStore((s) => s.updateBatteryProfile);
  const removeBatteryProfile = useSettingsStore((s) => s.removeBatteryProfile);
  const [name, setName] = useSyncedDraft(pack.name);
  const isDefault = pack.id === DEFAULT_BATTERY_PROFILE_ID;

  // An emptied name reverts rather than leaving a pack nobody can pick out.
  const commitName = () => {
    const next = name.trim();
    if (next && next !== pack.name) updateBatteryProfile(pack.id, { name: next });
    else setName(pack.name);
  };
  const deleteLabel = isDefault ? t("deleteDefaultReason") : t("delete", { name: pack.name });

  return (
    <div className={GRID}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        aria-label={t("nameOf", { name: pack.name })}
        className="h-7 min-w-0 rounded border border-border-default bg-bg-tertiary px-2 text-xs text-text-primary outline-none focus-ring"
      />
      <ScrubNumberField
        value={pack.capacityWh}
        onCommit={(v) => updateBatteryProfile(pack.id, { capacityWh: v })}
        min={1}
        max={100000}
        step={1}
        unit="Wh"
        ariaLabel={t("capacityOf", { name: pack.name })}
      />
      <ScrubNumberField
        value={pack.cruisePowerW}
        onCommit={(v) => updateBatteryProfile(pack.id, { cruisePowerW: v })}
        min={1}
        max={100000}
        step={1}
        unit="W"
        ariaLabel={t("cruiseOf", { name: pack.name })}
      />
      <ScrubNumberField
        value={pack.hoverPowerW}
        onCommit={(v) => updateBatteryProfile(pack.id, { hoverPowerW: v })}
        min={1}
        max={100000}
        step={1}
        unit="W"
        ariaLabel={t("hoverOf", { name: pack.name })}
      />
      <ScrubNumberField
        value={pack.reservePct}
        onCommit={(v) => updateBatteryProfile(pack.id, { reservePct: v })}
        min={0}
        max={90}
        step={1}
        unit="%"
        ariaLabel={t("reserveOf", { name: pack.name })}
      />
      <Tooltip content={deleteLabel} position="left">
        <button
          type="button"
          // aria-disabled keeps the reason reachable from the keyboard.
          aria-disabled={isDefault || undefined}
          aria-label={deleteLabel}
          onClick={isDefault ? undefined : () => removeBatteryProfile(pack.id)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded text-text-tertiary focus-ring",
            isDefault ? "cursor-not-allowed opacity-30" : "cursor-pointer hover:bg-bg-tertiary hover:text-status-error",
          )}
        >
          <Trash2 size={12} />
        </button>
      </Tooltip>
    </div>
  );
}
