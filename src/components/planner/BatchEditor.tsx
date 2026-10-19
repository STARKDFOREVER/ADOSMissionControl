"use client";

/**
 * @module BatchEditor
 * @description Multi-select waypoint editing. Shift+click and Ctrl/Cmd+click
 * build the selection. Each field shows the shared value, or "Mixed" when the
 * selected waypoints differ; a typed value is applied to every selected
 * waypoint with Set, and only the field set is changed.
 * @license GPL-3.0-only
 */

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PropertyRow } from "@/components/ui/property-row";
import { ScrubNumberField } from "@/components/ui/scrub-number-field";
import { useMissionStore } from "@/stores/mission-store";
import type { Waypoint, WaypointCommand } from "@/lib/types";

interface BatchEditorProps {
  selectedIds: string[];
  onClearSelection: () => void;
}

const BATCH_COMMANDS: WaypointCommand[] = ["WAYPOINT", "LOITER", "LOITER_TIME", "SPLINE_WAYPOINT"];

/** Whether every waypoint has the same value for `field`. */
function allSame(wps: Waypoint[], field: keyof Waypoint): boolean {
  return wps.every((wp) => wp[field] === wps[0][field]);
}

const setButtonClass =
  "h-7 px-2 rounded-sm text-xs text-text-secondary border border-border-default hover:bg-bg-tertiary hover:text-text-primary transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-ring";

export function BatchEditor({ selectedIds, onClearSelection }: BatchEditorProps) {
  const t = useTranslations("planner.inspector.batch");
  const batchUpdateWaypoints = useMissionStore((s) => s.batchUpdateWaypoints);
  const setWaypoints = useMissionStore((s) => s.setWaypoints);
  const waypoints = useMissionStore((s) => s.waypoints);

  const [batchAlt, setBatchAlt] = useState<number | null>(null);
  const [batchSpeed, setBatchSpeed] = useState<number | null>(null);
  const [batchCommand, setBatchCommand] = useState<string>("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const selected = useMemo(
    () => waypoints.filter((wp) => selectedIds.includes(wp.id)),
    [waypoints, selectedIds],
  );
  const count = selected.length;
  const first = selected[0];
  const altMixed = !allSame(selected, "alt");
  const speedMixed = !allSame(selected, "speed");
  const sharedCommand = allSame(selected, "command") ? first?.command : undefined;
  const commandPlaceholder = !sharedCommand
    ? t("mixedCommand")
    : BATCH_COMMANDS.includes(sharedCommand) ? t(`commands.${sharedCommand}`) : sharedCommand;

  const commandOptions = useMemo(
    () => BATCH_COMMANDS.map((value) => ({ value, label: t(`commands.${value}`) })),
    [t],
  );

  const applyAltitude = useCallback(() => {
    if (batchAlt === null) return;
    // One undo entry for the whole batch (not one per waypoint).
    batchUpdateWaypoints(selectedIds, { alt: batchAlt });
    setBatchAlt(null);
  }, [selectedIds, batchAlt, batchUpdateWaypoints]);

  const applySpeed = useCallback(() => {
    if (batchSpeed === null) return;
    batchUpdateWaypoints(selectedIds, { speed: batchSpeed });
    setBatchSpeed(null);
  }, [selectedIds, batchSpeed, batchUpdateWaypoints]);

  const applyCommand = useCallback(() => {
    if (!batchCommand) return;
    batchUpdateWaypoints(selectedIds, { command: batchCommand as WaypointCommand });
    setBatchCommand("");
  }, [selectedIds, batchCommand, batchUpdateWaypoints]);

  const deleteSelected = useCallback(() => {
    const remaining = waypoints.filter((wp) => !selectedIds.includes(wp.id));
    setWaypoints(remaining);
    onClearSelection();
  }, [waypoints, selectedIds, setWaypoints, onClearSelection]);

  if (count < 2) {
    return <p className="text-[11px] text-text-tertiary">{t("hint")}</p>;
  }

  return (
    <div className="flex flex-col">
      <PropertyRow label={t("altitude")}
        trailing={<button type="button" className={setButtonClass} onClick={applyAltitude} disabled={batchAlt === null}>{t("set")}</button>}>
        <ScrubNumberField value={batchAlt ?? (altMixed ? undefined : first?.alt)} mixed={batchAlt === null && altMixed}
          step={5} min={0} max={10000} unit="m" ariaLabel={t("altitude")} onCommit={setBatchAlt} />
      </PropertyRow>
      <PropertyRow label={t("speed")}
        trailing={<button type="button" className={setButtonClass} onClick={applySpeed} disabled={batchSpeed === null}>{t("set")}</button>}>
        <ScrubNumberField value={batchSpeed ?? (speedMixed ? undefined : first?.speed)} mixed={batchSpeed === null && speedMixed}
          placeholder={t("defaultSpeed")}
          step={1} min={0} max={100} unit="m/s" ariaLabel={t("speed")} onCommit={setBatchSpeed} />
      </PropertyRow>
      <PropertyRow label={t("command")}
        trailing={<button type="button" className={setButtonClass} onClick={applyCommand} disabled={!batchCommand}>{t("set")}</button>}>
        <Select value={batchCommand} onChange={setBatchCommand} options={commandOptions} placeholder={commandPlaceholder}
          ariaLabel={t("command")} compact  />
      </PropertyRow>

      <button type="button" onClick={() => setShowDeleteConfirm(true)}
        className="mt-3 flex h-7 items-center justify-center gap-1.5 rounded-sm border border-border-default text-xs text-status-error hover:bg-status-error/10 transition-colors cursor-pointer focus-ring">
        <Trash2 size={12} />
        {t("delete", { count })}
      </button>

      <ConfirmDialog
        open={showDeleteConfirm}
        onConfirm={() => {
          deleteSelected();
          setShowDeleteConfirm(false);
        }}
        onCancel={() => setShowDeleteConfirm(false)}
        title={t("deleteTitle")}
        message={t("deleteConfirm", { count })}
        confirmLabel={t("deleteConfirmLabel")}
        variant="danger"
      />
    </div>
  );
}
