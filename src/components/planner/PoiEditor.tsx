/**
 * @module PoiEditor
 * @description Plan-attached Points of Interest editor panel. Add, label,
 * annotate, reposition, and remove POIs. A POI is a pure GCS planning
 * annotation (a labelled marker with an optional note) — NOT an FC concept — so
 * there is no upload/download, only map rendering and save/load with the plan.
 * Mirrors {@link module:RallyPointEditor}.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useCallback, useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { Trash2, Plus } from "lucide-react";
import { PropertyRow } from "@/components/ui/property-row";
import { ScrubNumberField } from "@/components/ui/scrub-number-field";
import { useSyncedDraft } from "@/hooks/use-synced-draft";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePlanPoiStore, type PointOfInterest } from "@/stores/plan-poi-store";
import { usePlannerStore } from "@/stores/planner-store";
import { cn } from "@/lib/utils";

const SECONDARY_BUTTON =
  "flex h-7 items-center justify-center gap-1.5 rounded border border-border-default px-2 text-[11px] " +
  "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors cursor-pointer " +
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

const TEXT_FIELD =
  "h-7 w-full min-w-0 rounded-sm border border-transparent bg-bg-tertiary px-2 text-xs text-text-primary " +
  "outline-none transition-colors hover:border-border-default focus:border-accent-primary";

interface PoiEditorProps {
  /** POI to select, highlight and scroll into view (e.g. picked on the map). */
  focusId?: string | null;
}

export function PoiEditor({ focusId = null }: PoiEditorProps = {}) {
  const t = useTranslations("poi");
  const tCommon = useTranslations("common");
  // POI placement is the single sticky "poi" tool — keep clicking to drop
  // several points. The panel button is just another way to arm the same tool.
  const activeTool = usePlannerStore((s) => s.activeTool);
  const setActiveTool = usePlannerStore((s) => s.setActiveTool);
  const addingPoi = activeTool === "poi";
  const points = usePlanPoiStore((s) => s.points);
  const selectedId = usePlanPoiStore((s) => s.selectedId);
  const select = usePlanPoiStore((s) => s.select);
  const removePoint = usePlanPoiStore((s) => s.removePoint);
  const updatePoint = usePlanPoiStore((s) => s.updatePoint);
  const clearPoints = usePlanPoiStore((s) => s.clearPoints);
  const [confirmClear, setConfirmClear] = useState(false);

  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (!focusId) return;
    usePlanPoiStore.getState().select(focusId);
    rowRefs.current.get(focusId)?.scrollIntoView?.({ block: "nearest" });
  }, [focusId]);

  const registerRow = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const handleClear = useCallback(() => {
    setConfirmClear(false);
    clearPoints();
  }, [clearPoints]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setActiveTool(addingPoi ? "select" : "poi")}
          aria-pressed={addingPoi}
          className={cn(
            SECONDARY_BUTTON,
            "flex-1",
            addingPoi && "border-accent-primary bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/10 hover:text-accent-primary",
          )}
        >
          <Plus size={12} />
          {t("add")}
        </button>
        <button
          type="button"
          onClick={() => setConfirmClear(true)}
          disabled={points.length === 0}
          title={t("clear")}
          aria-label={t("clear")}
          className={cn(SECONDARY_BUTTON, "hover:text-status-error")}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {points.length === 0 ? (
        <p className="text-[11px] text-text-tertiary">{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {points.map((point, idx) => (
            <PoiRow
              key={point.id}
              point={point}
              index={idx}
              selected={point.id === selectedId}
              rowRef={registerRow}
              onSelect={select}
              onUpdate={updatePoint}
              onRemove={removePoint}
            />
          ))}
        </div>
      )}

      {addingPoi && <p className="text-[11px] text-accent-primary animate-pulse">{t("placeHint")}</p>}

      <ConfirmDialog
        open={confirmClear}
        title={t("clear")}
        message={t("clearAllConfirm", { count: points.length })}
        variant="danger"
        confirmLabel={tCommon("delete")}
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

// ── Individual POI row ────────────────────────────────────────

interface PoiRowProps {
  point: PointOfInterest;
  index: number;
  selected: boolean;
  rowRef: (id: string, el: HTMLDivElement | null) => void;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, update: Partial<PointOfInterest>) => void;
  onRemove: (id: string) => void;
}

function PoiRow({ point, index, selected, rowRef, onSelect, onUpdate, onRemove }: PoiRowProps) {
  const t = useTranslations("poi");
  const tPlanner = useTranslations("planner");
  const labelId = useId();
  const noteId = useId();
  // Drafts follow the point, so an undo or redo never gets reverted by a blur.
  const [localLabel, setLocalLabel] = useSyncedDraft(point.label ?? "");
  const [localNote, setLocalNote] = useSyncedDraft(point.note ?? "");

  // A blur that changed nothing writes nothing (and records no undo step).
  const commitLabel = useCallback(() => {
    const v = localLabel.trim() || undefined;
    if (v !== point.label) onUpdate(point.id, { label: v });
  }, [localLabel, point.id, point.label, onUpdate]);

  const commitNote = useCallback(() => {
    const v = localNote.trim() || undefined;
    if (v !== point.note) onUpdate(point.id, { note: v });
  }, [localNote, point.id, point.note, onUpdate]);

  return (
    <div
      ref={(el) => rowRef(point.id, el)}
      data-selected={selected || undefined}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(point.id)}
      className={cn(
        "-mx-1 flex cursor-pointer flex-col rounded px-1 pb-1 transition-colors",
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
        <span className="max-w-[45%] shrink-0 truncate text-xs text-text-primary">
          {point.label ?? `P${index + 1}`}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-tertiary">
          {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(point.id);
          }}
          title={t("remove")}
          aria-label={t("remove")}
          className="shrink-0 text-text-tertiary hover:text-status-error transition-colors cursor-pointer"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <PropertyRow label={t("label")} htmlFor={labelId}>
        <input
          id={labelId}
          type="text"
          value={localLabel}
          onChange={(e) => setLocalLabel(e.target.value)}
          onBlur={commitLabel}
          className={TEXT_FIELD}
        />
      </PropertyRow>
      {/* Coordinates follow the point, so a map drag never gets reverted by a blur. */}
      <PropertyRow label={tPlanner("lat")}>
        <ScrubNumberField value={point.lat} step={0.0001} precision={7} min={-90} max={90}
          ariaLabel={tPlanner("lat")} onCommit={(lat) => onUpdate(point.id, { lat })} />
      </PropertyRow>
      <PropertyRow label={tPlanner("lon")}>
        <ScrubNumberField value={point.lon} step={0.0001} precision={7} min={-180} max={180}
          ariaLabel={tPlanner("lon")} onCommit={(lon) => onUpdate(point.id, { lon })} />
      </PropertyRow>
      <PropertyRow label={t("note")} htmlFor={noteId}>
        <input
          id={noteId}
          type="text"
          value={localNote}
          onChange={(e) => setLocalNote(e.target.value)}
          onBlur={commitNote}
          className={TEXT_FIELD}
        />
      </PropertyRow>
    </div>
  );
}
