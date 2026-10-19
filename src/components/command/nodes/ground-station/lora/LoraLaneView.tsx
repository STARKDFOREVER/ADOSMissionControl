"use client";

/**
 * @module ground-station/lora/LoraLaneView
 * @description The fitted LoRa lane, governor first: blocked banner, region
 * card, governor meters with refusals, beacons heard and the receive /
 * Meshtastic cards. Transport-free so it renders from props in tests.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import type {
  LoraBeacon,
  LoraRegionPlan,
  LoraStatus,
  LoraUpdate,
} from "@/lib/api/ground-station-api";
import { remainingMs } from "./lora-format";
import { LoraBlockedBanner } from "./LoraBlockedBanner";
import { LoraRegionCard } from "./LoraRegionCard";
import { LoraGovernorMeters } from "./LoraGovernorMeters";
import { LoraBeaconsTable } from "./LoraBeaconsTable";
import { LoraMeshtasticCard } from "./LoraMeshtasticCard";
import { LoraRegionPicker } from "./LoraRegionPicker";

export interface LoraLaneViewProps {
  status: LoraStatus;
  regions: LoraRegionPlan[] | null;
  beacons: readonly LoraBeacon[];
  /** Wall clock for ages and the countdown (the shared 1 Hz clock). */
  now: number;
  /** When `status` was read; the countdown runs from here. */
  fetchedAt: number | null;
  /** Non-null while writes are refused (the vehicle may be armed). */
  writeLock: string | null;
  applying: boolean;
  onApply: (body: LoraUpdate) => void;
  /** Called when the region picker opens, to read the region table. */
  onOpenRegions?: () => void;
  /** Opens the node's country (regulatory region) setting, when reachable. */
  onOpenCountrySetting?: () => void;
}

export function LoraLaneView({
  status,
  regions,
  beacons,
  now,
  fetchedAt,
  writeLock,
  applying,
  onApply,
  onOpenRegions,
  onOpenCountrySetting,
}: LoraLaneViewProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const remaining = remainingMs(status.governor?.next_tx_allowed_ms ?? 0, fetchedAt, now);

  const openPicker = () => {
    setPickerOpen(true);
    onOpenRegions?.();
  };

  return (
    <div className="flex flex-col gap-3">
      <LoraBlockedBanner
        status={status}
        remainingMs={remaining}
        onOpenRegionPicker={openPicker}
        onOpenCountrySetting={onOpenCountrySetting}
        onOpenPowerSettings={() => setSettingsOpen(true)}
      />
      <LoraRegionCard
        status={status}
        remainingMs={remaining}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((v) => !v)}
        onOpenRegionPicker={openPicker}
        writeLock={writeLock}
        applying={applying}
        onApply={onApply}
      />
      <LoraGovernorMeters status={status} now={now} />
      <LoraBeaconsTable beacons={beacons} now={now} />
      <LoraMeshtasticCard status={status} />
      {pickerOpen ? (
        <LoraRegionPicker
          open
          onClose={() => setPickerOpen(false)}
          regions={regions}
          current={status.region}
          writeLock={writeLock}
          applying={applying}
          onApply={(region) => onApply({ region })}
        />
      ) : null}
    </div>
  );
}
