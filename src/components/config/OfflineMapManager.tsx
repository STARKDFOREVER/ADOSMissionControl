/**
 * @module OfflineMapManager
 * @description Map tile storage for Settings > Data: tiles kept from browsing,
 * tiles in downloaded areas, browser storage usage, and clearing each cache.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { getTileStorageStats, clearTileCache, type TileStorageStats } from "@/lib/tile-storage";
import { formatBytes } from "@/lib/tile-math";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, WifiOff, HardDrive, MapPinned } from "lucide-react";
import { CustomTileSourceEditor } from "@/components/map/CustomTileSourceEditor";
import { FieldTilePacksCard } from "./FieldTilePacksCard";

/** Cache Storage can stall (a busy disk, private mode); stop waiting after this. */
const CACHE_STATS_TIMEOUT_MS = 5_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(() => reject(new Error("Tile cache did not respond")), ms);
  work.then(resolve, reject).finally(() => clearTimeout(timer));
  return promise;
}

const EMPTY_STATS: TileStorageStats = { runtimeTiles: 0, pinnedTiles: 0, usageBytes: null, quotaBytes: null };

export function OfflineMapManager() {
  const t = useTranslations("offlineMapManager");
  const [stats, setStats] = useState<TileStorageStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [clearing, setClearing] = useState<"runtime" | "pinned" | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await withTimeout(getTileStorageStats(), CACHE_STATS_TIMEOUT_MS));
      setCacheError(null);
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Online/offline detection
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const handleClear = useCallback(
    async (which: "runtime" | "pinned") => {
      if (!confirm(t(which === "runtime" ? "clearRuntimeConfirm" : "clearPinnedConfirm"))) return;
      setClearing(which);
      try {
        await clearTileCache(which);
      } catch (err) {
        setCacheError(err instanceof Error ? err.message : String(err));
      } finally {
        await refreshStats();
        setClearing(null);
      }
    },
    [refreshStats, t],
  );

  const count = (n: number) => (loading ? "..." : cacheError ? "—" : n.toLocaleString());
  const { usageBytes, quotaBytes } = stats;
  const usagePct = usageBytes !== null && quotaBytes ? (usageBytes / quotaBytes) * 100 : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Offline warning */}
      {!isOnline && (
        <div className="flex items-center gap-2 px-3 py-2 bg-status-warning/10 border border-status-warning/30 rounded-lg">
          <WifiOff size={14} className="text-status-warning" />
          <span className="text-xs text-status-warning">{t("offlineWarning")}</span>
        </div>
      )}

      {/* Operator-supplied basemap. This is the only map-settings surface in
          /config, and it is where an operator sets up offline use — the map
          popover alone is unreachable on /plan before a plan exists. */}
      <Card title={t("customSourceTitle")} padding={true}>
        <CustomTileSourceEditor />
      </Card>

      <FieldTilePacksCard />

      <Card title={t("cacheTitle")} padding={true}>
        <div className="flex flex-col gap-3">
          {/* Browser storage for this origin. Tiles share it with plans and logs. */}
          {usageBytes !== null && quotaBytes !== null && (
            <div>
              <div className="flex justify-between text-[10px] font-mono text-text-secondary mb-1">
                <span>{t("storageUsage", { used: formatBytes(usageBytes), quota: formatBytes(quotaBytes) })}</span>
              </div>
              <div className="w-full h-2 bg-bg-tertiary rounded overflow-hidden">
                <div
                  className="h-full bg-accent-primary transition-all"
                  style={{ width: `${Math.min(usagePct, 100)}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1 text-[10px] font-mono text-text-secondary">
            <div className="flex items-center gap-1">
              <HardDrive size={10} />
              <span>{t("browsingTiles", { count: count(stats.runtimeTiles) })}</span>
            </div>
            <div className="flex items-center gap-1">
              <MapPinned size={10} />
              <span>{t("downloadedTiles", { count: count(stats.pinnedTiles) })}</span>
            </div>
          </div>
          {cacheError && (
            <p className="text-[10px] text-status-error">{t("unavailable", { error: cacheError })}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Trash2 size={12} />}
              onClick={() => handleClear("runtime")}
              disabled={clearing !== null || stats.runtimeTiles === 0}
            >
              {clearing === "runtime" ? t("clearing") : t("clearRuntime")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Trash2 size={12} />}
              onClick={() => handleClear("pinned")}
              disabled={clearing !== null || stats.pinnedTiles === 0}
            >
              {clearing === "pinned" ? t("clearing") : t("clearPinned")}
            </Button>
          </div>

          <p className="text-[9px] text-text-tertiary">{t("help")}</p>
        </div>
      </Card>
    </div>
  );
}
