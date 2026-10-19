/**
 * @module PlannerBar
 * @description Top bar of the active planner: plan identity (library toggle,
 * inline name, unsaved dot), vehicle assignment, issue count, Save, the single
 * primary "Send to vehicle" action and the plan overflow menu.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AlertTriangle, ArrowDownUp, Copy, Download, FileDown, FileOutput, FileSpreadsheet, FileText,
  FileUp, Globe, Library, Link2, MoreHorizontal, Move, Play, Save, Trash2, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useValidationOptions } from "@/hooks/use-validation-options";
import { useMissionUploadStatus } from "@/hooks/use-upload-status";
import { validateMission } from "@/lib/validation/mission-validator";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useVehicleOptions } from "./use-vehicle-options";
import type { PlannerShareImport } from "./use-planner-share-import";
import type { Planner } from "./use-planner";

interface PlannerBarProps {
  p: Planner;
  hasDrone: boolean;
  shareIo: PlannerShareImport;
  onOpenSend: () => void;
}

export function PlannerBar({ p, hasDrone, shareIo, onOpenSend }: PlannerBarProps) {
  const t = useTranslations("planner");
  const router = useRouter();
  const librarySheetOpen = usePlannerStore((s) => s.librarySheetOpen);
  const setLibrarySheetOpen = usePlannerStore((s) => s.setLibrarySheetOpen);
  const setDock = usePlannerStore((s) => s.setDock);
  const vehicleOptions = useVehicleOptions(p.drones);

  // Hard errors (out-of-fence, below terrain, bad jump target, ...) block the
  // send so an invalid mission can't be pushed to the FC.
  const validationOptions = useValidationOptions();
  const errorCount = useMemo(
    () => (p.waypoints.length > 0 ? validateMission(p.waypoints, validationOptions).errors.length : 0),
    [p.waypoints, validationOptions],
  );

  const hasWaypoints = p.waypoints.length > 0;
  const isDownloading = p.downloadState === "downloading";

  // Honest upload-state cue, from the upload receipt: "sent" only when the
  // selected drone acknowledged exactly the mission the planner would upload
  // now; an edit, a plan switch or another drone reads differently.
  const status = useMissionUploadStatus();
  const uploadError = useMissionStore((s) => s.uploadError);
  const sending = p.uploadState === "uploading";
  const sendLabel = errorCount > 0
    ? t("bar.fixIssues", { count: errorCount })
    : sending
      ? t("bar.sending")
      : status === "on-aircraft"
        ? t("bar.sent")
        : t("bar.send");
  const sendTitle = errorCount > 0
    ? t("uploadBlockedErrors", { count: errorCount })
    : !hasDrone
      ? t("bar.noVehicle")
      : !hasWaypoints
        ? t("bar.emptyMission")
        : undefined;
  const statusChip =
    p.uploadState === "error"
      ? {
          label: t("uploadFailed"),
          title: uploadError ? `${t("uploadFailed")}: ${uploadError}` : t("uploadFailed"),
          className: "text-status-error",
        }
      : status === "older-on-aircraft"
        ? { label: t("olderMissionOnAircraft"), title: t("olderMissionOnAircraft"), className: "text-status-warning" }
        : null;

  const overflowItems = [
    { id: "download-drone", label: isDownloading ? t("loading") : t("bar.downloadFromDrone"), icon: <Download size={12} />, disabled: isDownloading || !hasDrone },
    { id: "import-boundary", label: t("import.boundary.menuLabel"), icon: <FileUp size={12} /> },
    { id: "div1", label: "", divider: true },
    { id: "export-native", label: t("bar.exportNative"), icon: <FileDown size={12} /> },
    { id: "export-waypoints", label: t("exportWaypoints"), icon: <FileDown size={12} /> },
    { id: "export-plan", label: t("exportPlanQgc"), icon: <FileOutput size={12} /> },
    { id: "export-kml", label: t("exportKml"), icon: <Globe size={12} /> },
    { id: "export-kmz", label: t("bar.exportKmz"), icon: <Globe size={12} /> },
    { id: "export-csv", label: t("exportCsv"), icon: <FileSpreadsheet size={12} /> },
    { id: "export-brief", label: t("export.brief.menuLabel"), icon: <FileText size={12} />, disabled: !hasWaypoints },
    { id: "share-link", label: t("share.copyLink"), icon: <Link2 size={12} />, disabled: !hasWaypoints },
    { id: "save-as", label: t("bar.saveAs"), icon: <Copy size={12} /> },
    { id: "div2", label: "", divider: true },
    { id: "reverse", label: t("bar.reverse"), icon: <ArrowDownUp size={12} /> },
    { id: "transform", label: t("bar.transform"), icon: <Move size={12} /> },
    { id: "simulate", label: t("bar.simulate"), icon: <Play size={12} />, disabled: !hasWaypoints },
    { id: "div3", label: "", divider: true },
    { id: "discard", label: t("bar.discard"), icon: <Trash2 size={12} />, danger: true },
  ];

  const handleOverflow = (id: string) => {
    if (id === "download-drone") p.handleDownloadFromDrone();
    else if (id === "import-boundary") shareIo.handleImportBoundary();
    else if (id === "export-native") p.handleExportNative();
    else if (id === "export-waypoints") p.handleExportWaypoints();
    else if (id === "export-plan") p.handleExportPlan();
    else if (id === "export-kml") p.handleExportKML();
    else if (id === "export-kmz") p.handleExportKMZ();
    else if (id === "export-csv") p.handleExportCSV();
    else if (id === "export-brief") shareIo.handleExportBrief();
    else if (id === "share-link") void shareIo.handleCopyShareLink();
    else if (id === "save-as") p.handleSaveAs();
    else if (id === "reverse") p.handleReverseWaypoints();
    else if (id === "transform") {
      const store = usePlannerStore.getState();
      store.setInspectorTarget({ kind: "transform" });
      if (!store.inspectorOpen) store.toggleInspector();
    } else if (id === "simulate") router.push("/simulate");
    else if (id === "discard") p.handleClearAll();
  };

  return (
    <div className="h-10 shrink-0 flex items-center gap-2 px-2 border-b border-border-default bg-bg-secondary">
      <Button
        variant="ghost"
        size="sm"
        icon={<Library size={14} />}
        aria-pressed={librarySheetOpen}
        title={t("bar.plansTitle")}
        className={cn(librarySheetOpen && "text-accent-primary")}
        onClick={() => setLibrarySheetOpen(!librarySheetOpen)}
      >
        {t("bar.plans")}
      </Button>
      <PlanNameField name={p.missionName} onCommit={p.setMissionName} />
      {p.isDirty && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-status-warning shrink-0"
          role="status"
          aria-label={t("unsavedChanges")}
          title={t("unsavedChanges")}
        />
      )}

      <div className="flex-1" />

      <div className="w-48 shrink-0" title={t("bar.vehicle")}>
        <Select options={vehicleOptions} value={p.selectedDroneId} onChange={p.setSelectedDroneId} ariaLabel={t("bar.vehicle")} className="h-7 text-xs" />
      </div>
      {errorCount > 0 && (
        <button
          type="button"
          onClick={() => setDock("issues", true)}
          title={t("bar.issuesTitle")}
          aria-label={t("bar.issues", { count: errorCount })}
          className="h-7 inline-flex items-center gap-1 px-2 text-xs text-status-error hover:bg-bg-tertiary cursor-pointer focus-ring transition-colors"
        >
          <AlertTriangle size={12} />
          <span className="font-mono">{errorCount}</span>
        </button>
      )}
      {statusChip && (
        <span className={cn("text-[11px] truncate max-w-40", statusChip.className)} title={statusChip.title}>
          {statusChip.label}
        </span>
      )}
      <Button variant="secondary" size="sm" icon={<Save size={14} />} disabled={!p.isDirty} onClick={p.handleSave}>
        {t("bar.save")}
      </Button>
      <Button
        variant="primary"
        size="sm"
        icon={<Upload size={14} />}
        disabled={!hasWaypoints || !hasDrone || errorCount > 0}
        loading={sending}
        title={sendTitle}
        onClick={onOpenSend}
      >
        {sendLabel}
      </Button>
      <DropdownMenu
        trigger={<Button variant="ghost" size="sm" icon={<MoreHorizontal size={14} />} aria-label={t("bar.more")} title={t("bar.more")} />}
        items={overflowItems}
        onSelect={handleOverflow}
        align="right"
      />
    </div>
  );
}

/** Inline plan name: edits a draft, commits on blur or Enter, Esc reverts. */
function PlanNameField({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const t = useTranslations("planner");
  const [draft, setDraft] = useState(name);
  const [syncedName, setSyncedName] = useState(name);
  const revertRef = useRef(false);
  // Follow external renames (library rename, plan switch) while not editing.
  if (syncedName !== name) {
    setSyncedName(name);
    setDraft(name);
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      revertRef.current = true;
      setDraft(name);
      e.currentTarget.blur();
    }
  };

  return (
    <input
      type="text"
      value={draft}
      aria-label={t("bar.nameLabel")}
      placeholder={t("untitledMission")}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (revertRef.current) {
          revertRef.current = false;
          return;
        }
        if (draft !== name) onCommit(draft);
      }}
      className="h-7 min-w-0 w-56 px-1.5 bg-transparent border border-transparent text-sm font-medium text-text-primary placeholder:text-text-tertiary hover:border-border-default focus:border-accent-primary focus:outline-none focus-ring transition-colors"
    />
  );
}
