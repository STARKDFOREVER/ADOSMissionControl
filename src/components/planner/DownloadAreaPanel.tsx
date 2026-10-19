/**
 * @module DownloadAreaPanel
 * @description Panel for configuring and executing offline map tile downloads
 * for the CURRENT MAP VIEW. Opens from the map toolbar and caches the tiles
 * covering the current viewport bounds (there is no rectangle-draw tool — the
 * download area is whatever the map currently shows). Displays the tile
 * provider, zoom range, tile count, size estimate, and download progress.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { X, CloudDownload, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FloatingPanel } from "@/components/ui/floating-panel";
import {
  totalTileCount, estimateDownloadSize, formatBytes,
  BASEMAP_ORDER, basemapName, resolveBasemap, validateTileUrlTemplate,
  type LatLngBounds,
} from "@/lib/tile-math";
import { freeTileStorageBytes } from "@/lib/tile-storage";
import { useTileDownloadStore, MAX_DOWNLOAD_TILES } from "@/stores/tile-download-store";
import { cn } from "@/lib/utils";
import { useSettingsStore, type MapTileSource } from "@/stores/settings-store";

/** A result is a success only when nothing failed; all-failed is an error. */
function resultTone(r: { completed: number; skipped: number; failed: number }): "success" | "warning" | "error" {
  if (r.failed === 0) return "success";
  return r.completed + r.skipped > 0 ? "warning" : "error";
}

const RESULT_TONE = {
  success: "text-status-success",
  warning: "text-status-warning",
  error: "text-status-error",
} as const;

const SECTION_LABEL = "text-[11px] font-body font-semibold text-text-tertiary";

interface DownloadAreaPanelProps {
  bounds: LatLngBounds;
  currentZoom: number;
  currentProvider: MapTileSource;
  onClose: () => void;
}

export function DownloadAreaPanel({ bounds, currentZoom, currentProvider, onClose }: DownloadAreaPanelProps) {
  const t = useTranslations("planner.offline");
  const customTileUrl = useSettingsStore((s) => s.customTileUrl);
  const customTileMaxZoom = useSettingsStore((s) => s.customTileMaxZoom);
  const customTileAttribution = useSettingsStore((s) => s.customTileAttribution);
  const custom = useMemo(
    () => ({ url: customTileUrl, maxZoom: customTileMaxZoom, attribution: customTileAttribution }),
    [customTileUrl, customTileMaxZoom, customTileAttribution],
  );
  const customUsable = validateTileUrlTemplate(customTileUrl) === null;
  // Downloading CDN tiles for a custom source would cache them under the CDN's
  // URLs — a 100% miss for the on-screen custom layer, and internet traffic for
  // an operator who chose a self-hosted server precisely to avoid it.
  const [provider, setProvider] = useState<MapTileSource>(
    currentProvider === "field-pack"
      ? "streets-dark"
      : currentProvider === "custom" && !customUsable
        ? "dark"
        : currentProvider,
  );
  const providerConfig = resolveBasemap(provider, custom);
  const maxZoomForProvider = providerConfig.maxZoom;
  const customSelectedButUnusable = provider === "custom" && !customUsable;

  // Vector tiles are 512 px, so the view at zoom z shows tiles of z - 1.
  const isVector = providerConfig.kind === "vector";
  const viewZoom = isVector ? currentZoom - 1 : currentZoom;
  const floorZoom = isVector ? 0 : 1;
  // Sensible default: current zoom to +4, capped at provider max
  const defaultMinZoom = Math.min(maxZoomForProvider, Math.max(floorZoom, Math.round(viewZoom)));
  const defaultMaxZoom = Math.min(defaultMinZoom + 4, maxZoomForProvider);

  const [zoomMin, setZoomMin] = useState(defaultMinZoom);
  const [zoomMax, setZoomMax] = useState(defaultMaxZoom);

  const isDownloading = useTileDownloadStore((s) => s.isDownloading);
  const progress = useTileDownloadStore((s) => s.progress);
  const result = useTileDownloadStore((s) => s.result);
  const error = useTileDownloadStore((s) => s.error);
  const startDownload = useTileDownloadStore((s) => s.startDownload);
  const cancelDownload = useTileDownloadStore((s) => s.cancelDownload);
  const clearResult = useTileDownloadStore((s) => s.clearResult);

  // Calculate estimates
  const tileCount = useMemo(
    () => totalTileCount(bounds, zoomMin, zoomMax),
    [bounds, zoomMin, zoomMax],
  );
  const estSize = useMemo(
    () => estimateDownloadSize(bounds, zoomMin, zoomMax, providerConfig.avgTileKB),
    [bounds, zoomMin, zoomMax, providerConfig.avgTileKB],
  );

  // Downloaded areas are never evicted, so the warning is about the browser's
  // remaining quota, not a cache ceiling. Unknown quota shows no warning.
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    freeTileStorageBytes().then((b) => {
      if (live) setFreeBytes(b);
    });
    return () => {
      live = false;
    };
  }, [result]);

  const tooMany = tileCount > MAX_DOWNLOAD_TILES;
  const isLarge = !tooMany && tileCount > 50000;
  const wouldExceedStorage = freeBytes !== null && estSize > freeBytes;

  const handleDownload = useCallback(async () => {
    clearResult();
    await startDownload(bounds, zoomMin, zoomMax, providerConfig);
  }, [bounds, zoomMin, zoomMax, providerConfig, startDownload, clearResult]);

  const handleClose = useCallback(() => {
    if (isDownloading) cancelDownload();
    onClose();
  }, [isDownloading, cancelDownload, onClose]);

  const progressPct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;

  return (
    <FloatingPanel layer="popover" padded={false} className="top-24 left-14 w-72 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <CloudDownload size={12} className="text-accent-primary" />
          <span className="text-[11px] font-body font-semibold text-text-primary">
            {t("title")}
          </span>
        </div>
        <button
          onClick={handleClose}
          aria-label={t("close")}
          className="text-text-tertiary hover:text-text-primary cursor-pointer"
        >
          <X size={12} />
        </button>
      </div>

      <div className="px-3 py-2 flex flex-col gap-2.5">
        {/* Honest scope: this caches the tiles for the current map viewport,
            not a separately-drawn rectangle. */}
        <p className="text-[11px] text-text-tertiary leading-snug">
          {t("scope")}
        </p>
        {/* Provider */}
        <div>
          <label className={SECTION_LABEL}>{t("provider")}</label>
          <Select
            value={provider}
            onChange={(v) => {
              const next = v as MapTileSource;
              setProvider(next);
              const newMax = resolveBasemap(next, custom).maxZoom;
              if (zoomMax > newMax) setZoomMax(newMax);
              if (zoomMin > newMax) setZoomMin(newMax);
            }}
            options={BASEMAP_ORDER
              .filter((s) => s !== "custom" || customUsable)
              .map((s) => ({ value: s, label: basemapName(s) }))}
            disabled={isDownloading}
          />
        </div>

        {/* Zoom range */}
        <div>
          <label className={SECTION_LABEL}>
            {t("zoomRange", { min: zoomMin, max: zoomMax })}
          </label>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="range"
              min={floorZoom}
              max={maxZoomForProvider}
              value={zoomMin}
              onChange={(e) => {
                const v = Number(e.target.value);
                setZoomMin(v);
                if (v > zoomMax) setZoomMax(v);
              }}
              className="flex-1 h-1 accent-accent-primary"
              disabled={isDownloading}
            />
            <input
              type="range"
              min={floorZoom}
              max={maxZoomForProvider}
              value={zoomMax}
              onChange={(e) => {
                const v = Number(e.target.value);
                setZoomMax(v);
                if (v < zoomMin) setZoomMin(v);
              }}
              className="flex-1 h-1 accent-accent-primary"
              disabled={isDownloading}
            />
          </div>
        </div>

        {/* Estimates */}
        <div className="flex justify-between text-[11px] font-mono">
          <span className="text-text-secondary">{t("tiles", { count: tileCount.toLocaleString() })}</span>
          <span className="text-text-secondary">~{formatBytes(estSize)}</span>
        </div>

        {/* Warnings */}
        {isLarge && !isDownloading && (
          <p className="flex items-start gap-1.5 text-[11px] text-status-warning">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            {t("large", { count: tileCount.toLocaleString() })}
          </p>
        )}
        {tooMany && !isDownloading && (
          <p className="flex items-start gap-1.5 text-[11px] text-status-error">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            {t("tooMany", { count: tileCount.toLocaleString(), limit: MAX_DOWNLOAD_TILES.toLocaleString() })}
          </p>
        )}
        {wouldExceedStorage && !tooMany && !isDownloading && (
          <p className="flex items-start gap-1.5 text-[11px] text-status-warning">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            {t("exceedStorage", { free: formatBytes(freeBytes ?? 0) })}
          </p>
        )}

        {/* Download progress */}
        {isDownloading && (
          <div className="flex flex-col gap-1">
            <div className="w-full h-1.5 bg-bg-tertiary rounded overflow-hidden">
              <div
                className="h-full bg-accent-primary transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] font-mono text-text-tertiary">
              <span>{progress.completed.toLocaleString()} / {progress.total.toLocaleString()}</span>
              <span>{formatBytes(progress.bytes)}</span>
            </div>
            {progress.skipped > 0 && (
              <span className="text-[11px] text-text-tertiary">
                {t("alreadyCached", { count: progress.skipped.toLocaleString() })}
              </span>
            )}
          </div>
        )}

        {/* Result */}
        {result && !isDownloading && (
          <p className={cn("text-[11px]", RESULT_TONE[resultTone(result)])}>
            {t("downloaded", { count: result.completed.toLocaleString(), size: formatBytes(result.totalBytes) })}
            {result.skipped > 0 && t("downloadedSkipped", { count: result.skipped.toLocaleString() })}
            {result.failed > 0 && t("downloadedFailed", { count: result.failed.toLocaleString() })}
          </p>
        )}

        {/* Error */}
        {error && !isDownloading && (
          <p className="text-[11px] text-status-error">{error}</p>
        )}

        {/* Belt-and-braces: the select filters this option out, but a stale
            `currentProvider` can still seed it. */}
        {customSelectedButUnusable && !isDownloading && (
          <p className="text-[11px] text-status-error">{t("customUnusable")}</p>
        )}
      </div>

      {/* Actions */}
      <div className="px-3 py-2 border-t border-border-default flex gap-2">
        {isDownloading ? (
          <Button variant="secondary" size="sm" onClick={cancelDownload} className="w-full">
            {t("cancel")}
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={handleClose} className="flex-1">
              {t("close")}
            </Button>
            <Button variant="primary" size="sm" onClick={handleDownload} className="flex-1"
              disabled={customSelectedButUnusable || tooMany || zoomMin > zoomMax || tileCount === 0}
              icon={<CloudDownload size={12} />}>
              {t("download")}
            </Button>
          </>
        )}
      </div>
    </FloatingPanel>
  );
}
