/**
 * @module ServiceWorkerRegistrar
 * @description Registers `/sw.js` (map tile cache and app shell) and tells it
 * which hosts serve map tiles: every built-in basemap, the operator's custom
 * source and the paired ground station serving field tile packs. The list is
 * re-sent whenever one of those changes.
 * Registration runs in production builds, or in dev with
 * `NEXT_PUBLIC_ENABLE_SW=true`.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useFieldPackStore } from "@/stores/field-pack-store";
import { TILE_PROVIDERS, fieldPackTileUrl } from "@/lib/tile-math";
import { tileHostPattern } from "@/lib/tile-cache-key";

const SW_ENABLED =
  process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "true";

/** Host patterns the service worker treats as tile servers. */
export function tileHostList(customTileUrl: string, fieldPackBaseUrl?: string | null): string[] {
  const hosts = new Set<string>();
  for (const provider of Object.values(TILE_PROVIDERS)) {
    const host = tileHostPattern(provider.url);
    if (host) hosts.add(host);
  }
  const custom = tileHostPattern(customTileUrl);
  if (custom) hosts.add(custom);
  const field = fieldPackBaseUrl ? tileHostPattern(fieldPackTileUrl(fieldPackBaseUrl, "pack")) : null;
  if (field) hosts.add(field);
  return [...hosts];
}

function postConfig(registration: ServiceWorkerRegistration, tileHosts: string[]): void {
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  worker?.postMessage({ type: "config", tileHosts });
}

export function ServiceWorkerRegistrar() {
  const customTileUrl = useSettingsStore((s) => s.customTileUrl);
  const fieldPackBaseUrl = useFieldPackStore((s) => s.source?.baseUrl ?? null);

  useEffect(() => {
    if (!SW_ENABLED || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const tileHosts = tileHostList(customTileUrl, fieldPackBaseUrl);
    let cancelled = false;
    const container = navigator.serviceWorker;
    const resend = () => {
      container.ready.then((reg) => postConfig(reg, tileHosts)).catch(() => {});
    };

    container
      .register("/sw.js", { scope: "/" })
      .then(() => container.ready)
      .then((reg) => {
        if (!cancelled) postConfig(reg, tileHosts);
      })
      .catch((err) => console.warn("[sw] registration failed", err));
    // A new worker taking over starts with whatever config it stored last.
    container.addEventListener("controllerchange", resend);
    return () => {
      cancelled = true;
      container.removeEventListener("controllerchange", resend);
    };
  }, [customTileUrl, fieldPackBaseUrl]);

  return null;
}
