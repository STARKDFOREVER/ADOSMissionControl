/**
 * @module DownloadAreaPanel
 * @description Panel for downloading an offline area: the map tiles and,
 * optionally, the ground elevation over either the current map view or the
 * plan's own area (its waypoints, planned home, fence and rally points plus
 * 500 m). Opens from the map toolbar. Displays the tile provider, zoom range,
 * tile count, size estimate, and the tile and elevation progress separately.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { X, CloudDownload, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toggle } from "@/components/ui/toggle";
import { FloatingPanel } from "@/components/ui/floating-panel";
import {
  totalTileCount, estimateDownloadSize, formatBytes,
  BASEMAP_ORDER, basemapName, resolveBasemap, validateTileUrlTemplate,
  type LatLngBounds,
} from "@/lib/tile-math";
import { freeTileStorageBytes } from "@/lib/tile-storage";
import { planAreaBounds } from "@/lib/geo/plan-bounds";
import { useTileDownloadStore, MAX_DOWNLOAD_TILES } from "@/stores/tile-download-store";
import { cn } from "@/lib/utils";
import { useSettingsStore, type MapTileSource } from "@/stores/settings-store";
import { useMissionStore } from "@/stores/mission-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import { useTerrainPrefetch } from "./use-terrain-prefetch";

type DownloadArea = "view" | "plan";

/** Buffer around the plan's outermost point, metres. */
const PLAN_AREA_BUFFER_M = 500;

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
  /** The current map view. */
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
  const { start: startTerrain, cancel: cancelTerrain, clear: clearTerrain, ...terrain } = useTerrainPrefetch();
  const busy = isDownloading || terrain.running;

  const waypoints = useMissionStore((s) => s.waypoints);
  const plannedHome = useMissionStore((s) => s.plannedHome);
  const fenceType = useGeofenceStore((s) => s.fenceType);
  const circleCenter = useGeofenceStore((s) => s.circleCenter);
  const circleRadius = useGeofenceStore((s) => s.circleRadius);
  const polygonPoints = useGeofenceStore((s) => s.polygonPoints);
  const zones = useGeofenceStore((s) => s.zones);
  const rally = useRallyStore((s) => s.points);
  const planBounds = useMemo(
    () => planAreaBounds(waypoints, plannedHome, { fenceType, circleCenter, circleRadius, polygonPoints, zones }, rally, PLAN_AREA_BUFFER_M),
    [waypoints, plannedHome, fenceType, circleCenter, circleRadius, polygonPoints, zones, rally],
  );
  const [area, setArea] = useState<DownloadArea>("view");
  // Plan area falls back to the view when the plan places nothing.
  const areaBounds = area === "plan" && planBounds ? planBounds : bounds;
  const [includeTerrain, setIncludeTerrain] = useState(true);

  // Calculate estimates
  const tileCount = useMemo(
    () => totalTileCount(areaBounds, zoomMin, zoomMax),
    [areaBounds, zoomMin, zoomMax],
  );
  const estSize = useMemo(
    () => estimateDownloadSize(areaBounds, zoomMin, zoomMax, providerConfig.avgTileKB),
    [areaBounds, zoomMin, zoomMax, providerConfig.avgTileKB],
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

  // Tiles and elevation download side by side; neither waits on the other.
  const handleDownload = useCallback(async () => {
    clearResult();
    clearTerrain();
    await Promise.all([
      startDownload(areaBounds, zoomMin, zoomMax, providerConfig),
      includeTerrain ? startTerrain(areaBounds) : Promise.resolve(),
    ]);
  }, [areaBounds, zoomMin, zoomMax, providerConfig, startDownload, clearResult, includeTerrain, startTerrain, clearTerrain]);

  const handleCancel = useCallback(() => {
    cancelDownload();
    cancelTerrain();
  }, [cancelDownload, cancelTerrain]);

  const handleClose = useCallback(() => {
    if (busy) handleCancel();
    onClose();
  }, [busy, handleCancel, onClose]);

  const progressPct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;
  const terrainPct = terrain.progress && terrain.progress.total > 0
    ? (terrain.progress.done / terrain.progress.total) * 100
    : 0;

  return (
    <FloatingPanel layer="popover" padded={false} className="top-24 left-14 w-72 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <CloudDownload size={12} className="text-accent-primary" />
          <span className="text-[11px] font-body font-semibold text-text-primary">
            {t("areaTitle")}
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
        {/* Area: the current view, or everything the plan places plus a margin. */}
        <div className="flex flex-col gap-1">
          <label className={SECTION_LABEL}>{t("area")}</label>
          <SegmentedControl<DownloadArea>
            value={area === "plan" && planBounds ? "plan" : "view"}
            onChange={setArea}
            size="sm"
            stretch
            ariaLabel={t("area")}
            options={[
              { value: "view", label: t("areaView") },
              {
                value: "plan",
                label: t("areaPlan"),
                disabled: planBounds === null,
                title: planBounds === null ? t("areaPlanEmpty") : t("areaPlanTitle"),
              },
            ]}
          />
          <p className="text-[11px] text-text-tertiary leading-snug">
            {area === "plan" && planBounds ? t("scopePlan") : t("scope")}
          </p>
        </div>
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
            disabled={busy}
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
              disabled={busy}
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
              disabled={busy}
            />
          </div>
        </div>

        {/* Estimates */}
        <div className="flex justify-between text-[11px] font-mono">
          <span className="text-text-secondary">{t("tiles", { count: tileCount.toLocaleString() })}</span>
          <span className="text-text-secondary">~{formatBytes(estSize)}</span>
        </div>

        <Toggle
          label={t("includeTerrain")}
          checked={includeTerrain}
          onChange={setIncludeTerrain}
          disabled={busy}
        />

        {/* Warnings */}
        {isLarge && !busy && (
          <p className="flex items-start gap-1.5 text-[11px] text-status-warning">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            {t("large", { count: tileCount.toLocaleString() })}
          </p>
        )}
        {tooMany && !busy && (
          <p className="flex items-start gap-1.5 text-[11px] text-status-error">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            {t("tooMany", { count: tileCount.toLocaleString(), limit: MAX_DOWNLOAD_TILES.toLocaleString() })}
          </p>
        )}
        {wouldExceedStorage && !tooMany && !busy && (
          <p className="flex items-start gap-1.5 text-[11px] text-status-warning">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            {t("exceedStorage", { free: formatBytes(freeBytes ?? 0) })}
          </p>
        )}

        {/* Download progress: tiles and elevation cells counted apart. */}
        {isDownloading && (
          <div className="flex flex-col gap-1">
            <div className="w-full h-1.5 bg-bg-tertiary rounded overflow-hidden">
              <div
                className="h-full bg-accent-primary transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] font-mono text-text-tertiary">
              <span>
                {t("progressTiles", { done: progress.completed.toLocaleString(), total: progress.total.toLocaleString() })}
              </span>
              <span>{formatBytes(progress.bytes)}</span>
            </div>
            {progress.skipped > 0 && (
              <span className="text-[11px] text-text-tertiary">
                {t("alreadyCached", { count: progress.skipped.toLocaleString() })}
              </span>
            )}
          </div>
        )}
        {terrain.running && (
          <div className="flex flex-col gap-1">
            <div className="w-full h-1.5 bg-bg-tertiary rounded overflow-hidden">
              <div
                className="h-full bg-status-success transition-all duration-200"
                style={{ width: `${terrainPct}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-text-tertiary">
              {terrain.progress
                ? t("progressElevation", {
                    done: terrain.progress.done.toLocaleString(),
                    total: terrain.progress.total.toLocaleString(),
                  })
                : t("elevationStarting")}
            </span>
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

        {/* Elevation result and error */}
        {terrain.result && !terrain.running && (
          <p className={cn("text-[11px]", terrain.result.failed > 0 ? "text-status-warning" : "text-status-success")}>
            {t("elevationDone", { count: terrain.result.fetched.toLocaleString() })}
            {terrain.result.failed > 0 && t("downloadedFailed", { count: terrain.result.failed.toLocaleString() })}
          </p>
        )}
        {terrain.error && !terrain.running && (
          <p role="alert" className="flex items-start gap-1.5 text-[11px] text-status-error">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            {terrain.error.kind === "tooLarge"
              ? t("elevationTooLarge")
              : t("elevationFailed", { reason: terrain.error.reason })}
          </p>
        )}

        {/* Belt-and-braces: the select filters this option out, but a stale
            `currentProvider` can still seed it. */}
        {customSelectedButUnusable && !busy && (
          <p className="text-[11px] text-status-error">{t("customUnusable")}</p>
        )}
      </div>

      {/* Actions */}
      <div className="px-3 py-2 border-t border-border-default flex gap-2">
        {busy ? (
          <Button variant="secondary" size="sm" onClick={handleCancel} className="w-full">
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
