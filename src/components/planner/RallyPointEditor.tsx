/**
 * @module RallyPointEditor
 * @description Rally (safe return) point editor panel. Allows adding, editing,
 * uploading, and downloading rally points. Rally points are alternate landing
 * locations the FC can use during failsafe events.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Upload, Download, Trash2, Plus } from "lucide-react";
import { PropertyRow } from "@/components/ui/property-row";
import { ScrubNumberField } from "@/components/ui/scrub-number-field";
import { useRallyStore, type RallyPoint } from "@/stores/rally-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useRallyUploadStatus } from "@/hooks/use-upload-status";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

const SECONDARY_BUTTON =
  "flex h-7 items-center justify-center gap-1.5 rounded border border-border-default px-2 text-[11px] " +
  "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors cursor-pointer " +
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

interface RallyPointEditorProps {
  /** Rally point to highlight and scroll into view (e.g. picked on the map). */
  focusId?: string | null;
}

export function RallyPointEditor({ focusId = null }: RallyPointEditorProps = {}) {
  const t = useTranslations("rally");
  const tCommon = useTranslations("common");
  // Rally placement is the single sticky "rally" tool — keep clicking to drop
  // several points. The panel button is just another way to arm the same tool.
  const activeTool = usePlannerStore((s) => s.activeTool);
  const setActiveTool = usePlannerStore((s) => s.setActiveTool);
  const addingRallyPoint = activeTool === "rally";
  const points = useRallyStore((s) => s.points);
  const removePoint = useRallyStore((s) => s.removePoint);
  const updatePoint = useRallyStore((s) => s.updatePoint);
  const clearPoints = useRallyStore((s) => s.clearPoints);
  const uploadRallyPoints = useRallyStore((s) => s.uploadRallyPoints);
  const downloadRallyPoints = useRallyStore((s) => s.downloadRallyPoints);

  // The rally store keeps no selection, so the highlighted row is local. A
  // new `focusId` from the parent moves it.
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [prevFocusId, setPrevFocusId] = useState<string | null>(focusId);
  if (focusId !== prevFocusId) {
    setPrevFocusId(focusId);
    if (focusId) setSelectedId(focusId);
  }
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (focusId) rowRefs.current.get(focusId)?.scrollIntoView?.({ block: "nearest" });
  }, [focusId]);

  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // The last transfer's failure, shown until the next attempt. Success is not
  // latched here: "uploaded" is derived from the upload receipt, so an edit
  // or a drone switch changes it immediately.
  const [transferError, setTransferError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const uploadStatus = useRallyUploadStatus();
  // Transfers need a selected flight controller that speaks the rally protocol.
  const canUpload = useDroneManager((s) => !!s.getSelectedProtocol()?.uploadRallyPoints);
  const canDownload = useDroneManager((s) => !!s.getSelectedProtocol()?.downloadRallyPoints);

  const handleUpload = useCallback(async () => {
    setUploading(true);
    setTransferError(null);
    const r = await uploadRallyPoints();
    if (!r.success) setTransferError(`${t("rallyUploadFailed")}: ${r.message}`);
    setUploading(false);
  }, [uploadRallyPoints, t]);

  const runDownload = useCallback(async () => {
    setConfirmReplace(false);
    setDownloading(true);
    setTransferError(null);
    const r = await downloadRallyPoints();
    if (!r.success) setTransferError(`${t("downloadFailed")}: ${r.message}`);
    setDownloading(false);
  }, [downloadRallyPoints, t]);

  const handleClear = useCallback(() => {
    setConfirmClear(false);
    clearPoints();
  }, [clearPoints]);

  const handleDownload = useCallback(() => {
    if (points.length > 0) setConfirmReplace(true);
    else void runDownload();
  }, [points.length, runDownload]);

  const registerRow = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setActiveTool(addingRallyPoint ? "select" : "rally")}
            aria-pressed={addingRallyPoint}
            className={cn(
              SECONDARY_BUTTON,
              "flex-1",
              addingRallyPoint && "border-accent-primary bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/10 hover:text-accent-primary",
            )}
          >
            <Plus size={12} />
            {t("addRally")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            disabled={points.length === 0}
            title={t("clearRally")}
            aria-label={t("clearRally")}
            className={cn(SECONDARY_BUTTON, "hover:text-status-error")}
          >
            <Trash2 size={12} />
          </button>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading || points.length === 0 || !canUpload}
            className={cn(SECONDARY_BUTTON, "min-w-0 flex-1")}
          >
            <Upload size={12} className="shrink-0" />
            <span className="truncate">{uploading ? "..." : t("uploadRally")}</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading || !canDownload}
            className={cn(SECONDARY_BUTTON, "min-w-0 flex-1")}
          >
            <Download size={12} className="shrink-0" />
            <span className="truncate">{downloading ? "..." : t("downloadRally")}</span>
          </button>
        </div>
      </div>

      {points.length === 0 ? (
        <p className="text-[11px] text-text-tertiary">{t("noRallyPoints")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {points.map((point, idx) => (
            <RallyPointRow
              key={point.id}
              point={point}
              index={idx}
              selected={point.id === selectedId}
              rowRef={registerRow}
              onSelect={setSelectedId}
              onUpdate={updatePoint}
              onRemove={removePoint}
            />
          ))}
        </div>
      )}

      {uploadStatus === "on-aircraft" && (
        <p className="text-[11px] text-status-success">{t("rallyUploaded")}</p>
      )}
      {uploadStatus === "older-on-aircraft" && (
        <p className="text-[11px] text-status-warning">{t("olderRallyOnAircraft")}</p>
      )}
      {transferError && <p className="text-[11px] text-status-error">{transferError}</p>}

      {addingRallyPoint && (
        <p className="text-[11px] text-accent-primary animate-pulse">{t("clickToAdd")}</p>
      )}

      <ConfirmDialog
        open={confirmReplace}
        title={t("downloadRally")}
        message={t("replaceLocalConfirm", { count: points.length })}
        onConfirm={() => void runDownload()}
        onCancel={() => setConfirmReplace(false)}
      />
      <ConfirmDialog
        open={confirmClear}
        title={t("clearRally")}
        message={t("clearAllConfirm", { count: points.length })}
        variant="danger"
        confirmLabel={tCommon("delete")}
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

// ── Individual rally point row ────────────────────────────────

interface RallyPointRowProps {
  point: RallyPoint;
  index: number;
  selected: boolean;
  rowRef: (id: string, el: HTMLDivElement | null) => void;
  onSelect: (id: string) => void;
  onUpdate: (id: string, update: Partial<RallyPoint>) => void;
  onRemove: (id: string) => void;
}

function RallyPointRow({ point, index, selected, rowRef, onSelect, onUpdate, onRemove }: RallyPointRowProps) {
  const t = useTranslations("rally");
  const tPlanner = useTranslations("planner");
  const tEditor = useTranslations("planner.inspector.editor");
  // Fields follow the point, so a map drag shows here at once and a later blur
  // never writes the pre-drag coordinates back.
  return (
    <div
      ref={(el) => rowRef(point.id, el)}
      data-selected={selected || undefined}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(point.id)}
      className={cn(
        "-mx-1 flex flex-col rounded px-1 pb-1 transition-colors",
        selected ? "bg-accent-primary/10" : "hover:bg-bg-tertiary/50",
      )}
    >
      <div className="flex min-h-7 items-center gap-2">
        <span
          className={cn(
            "flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 font-mono text-[11px]",
            selected ? "bg-accent-primary text-accent-foreground" : "bg-bg-tertiary text-text-secondary",
          )}
        >
          {index + 1}
        </span>
        <span className="shrink-0 text-xs text-text-primary">{t("rallyNum", { num: index + 1 })}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-tertiary">
          {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(point.id);
          }}
          title={tEditor("removeRallyPoint")}
          aria-label={tEditor("removeRallyPoint")}
          className="shrink-0 text-text-tertiary hover:text-status-error transition-colors cursor-pointer"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <PropertyRow label={tPlanner("lat")}>
        <ScrubNumberField value={point.lat} step={0.0001} precision={7} min={-90} max={90}
          ariaLabel={tPlanner("lat")} onCommit={(lat) => onUpdate(point.id, { lat })} />
      </PropertyRow>
      <PropertyRow label={tPlanner("lon")}>
        <ScrubNumberField value={point.lon} step={0.0001} precision={7} min={-180} max={180}
          ariaLabel={tPlanner("lon")} onCommit={(lon) => onUpdate(point.id, { lon })} />
      </PropertyRow>
      <PropertyRow label={t("altitude")}>
        <ScrubNumberField value={point.alt} step={1} min={0} unit="m"
          ariaLabel={t("altitude")} onCommit={(alt) => onUpdate(point.id, { alt })} />
      </PropertyRow>
    </div>
  );
}
