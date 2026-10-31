"use client";

/**
 * @module vision/ModelPicker
 * @description Board-filtered vision model picker. One component, two modes:
 *   - `full` — the management surface in the Vision tab: a labelled section
 *     with cache usage, a refresh control, and an Upload button.
 *   - `compact` — the inline widget the plugin parameter renderer drops in for
 *     a `model` / `model_upload` parameter bound to `engine.detector`.
 *
 * It merges the agent's registry + installed + custom models into one list
 * (deduped, board-tagged via the pure `filterModelsForBoard`), shows which one
 * the engine has active, and lets the operator:
 *   - Download a not-yet-installed registry model, polling its progress.
 *   - Set any installed model as the engine's active detector. Because the
 *     detector is engine-wide (every vision consumer shares it), the picker
 *     says so.
 *   - Upload a custom model file (the ModelUploadDialog).
 *
 * Setting the active detector is engine-wide, so the write routes through the
 * `engine.detector` LAN seam (`setEngineDetector`) keyed by the drone. The
 * picker takes a `droneId` so the right agent is reached (local-first).
 *
 * @license GPL-3.0-only
 */
import { useTranslations } from "next-intl";
import { RefreshCw, AlertTriangle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModelUploadDialog } from "./ModelUploadDialog";
import { ModelPickerRows } from "./ModelPickerRows";
import type { PickerMode } from "./model-picker-labels";
import { useModelPicker } from "./use-model-picker";

interface ModelPickerProps {
  /** Drone whose engine detector this picker manages (LAN routing). */
  droneId: string;
  /** Render mode. `full` is the Vision tab surface; `compact` is the inline
   * parameter widget. Defaults to `full`. */
  mode?: PickerMode;
  /** Fired after the active detector changes (compact widgets sync up). */
  onActiveChange?: (modelId: string) => void;
  /** Suppress the compact mode's own "Detector" header text (the upload +
   * refresh controls stay). Set when a parent (e.g. ParameterControl) already
   * renders the parameter's label, so the two don't double up. Ignored in
   * `full` mode, which has no such parent label. */
  hideHeaderLabel?: boolean;
}

export function ModelPicker({
  droneId,
  mode = "full",
  onActiveChange,
  hideHeaderLabel = false,
}: ModelPickerProps) {
  const t = useTranslations("vision");
  const {
    isHardBlocked,
    hardBlockMessage,
    data,
    loading,
    error,
    downloads,
    settingActive,
    uploadOpen,
    setUploadOpen,
    models,
    refresh,
    startDownload,
    setActive,
    handleUpload,
  } = useModelPicker(droneId, onActiveChange);

  const rows = (
    <ModelPickerRows
      models={models}
      mode={mode}
      downloads={downloads}
      settingActive={settingActive}
      isHardBlocked={isHardBlocked}
      hardBlockMessage={hardBlockMessage}
      startDownload={startDownload}
      setActive={setActive}
    />
  );

  const uploadButton = (
    <Button
      variant="ghost"
      size="sm"
      icon={<Upload size={13} />}
      onClick={() => setUploadOpen(true)}
      disabled={isHardBlocked}
      title={isHardBlocked ? hardBlockMessage : undefined}
    >
      {t("upload")}
    </Button>
  );

  const errorBox = error ? (
    <div className="flex items-center gap-2 rounded border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
      <AlertTriangle size={13} />
      {error}
    </div>
  ) : null;

  const emptyNote =
    !error && data && models.length === 0 ? (
      <p className="py-3 text-center text-xs text-text-tertiary">
        {t("emptyRegistry")}
      </p>
    ) : null;

  const engineNote =
    mode === "compact" ? (
      <p className="text-[10px] leading-tight text-text-tertiary">
        {t("engineWideNote")}
      </p>
    ) : null;

  const dialog = (
    <ModelUploadDialog
      open={uploadOpen}
      onClose={() => setUploadOpen(false)}
      onUpload={handleUpload}
      onUploaded={() => refresh()}
    />
  );

  if (mode === "compact") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          {/* The parent (ParameterControl) may already render the parameter
              label; suppress this header text then so the label isn't doubled.
              The empty span keeps the controls right-aligned via justify-between. */}
          {hideHeaderLabel ? (
            <span />
          ) : (
            <span className="text-xs text-text-secondary">{t("detector")}</span>
          )}
          <div className="flex items-center gap-1">
            {uploadButton}
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw size={12} />}
              onClick={refresh}
              disabled={loading}
            >
              {t("refresh")}
            </Button>
          </div>
        </div>
        {errorBox}
        {emptyNote}
        {!error && data ? rows : null}
        {engineNote}
        {dialog}
      </div>
    );
  }

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary">
          {t("modelRegistry")}
        </h3>
        <div className="flex items-center gap-3">
          {data ? (
            <span className="font-mono text-[11px] text-text-tertiary">
              {t("cacheUsage", {
                used: data.cache.usedMb.toFixed(0),
                max: data.cache.maxMb.toFixed(0),
              })}
            </span>
          ) : null}
          {uploadButton}
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={13} />}
            onClick={refresh}
            disabled={loading}
          >
            {t("refresh")}
          </Button>
        </div>
      </div>

      {errorBox}
      {emptyNote}
      {!error && data ? rows : null}
      {dialog}
    </section>
  );
}
