/**
 * @module BatteryChangeBadges
 * @description A small "⚡2" badge beside the waypoint where each battery pack
 * after the first takes over, from the shared energy estimate's pack split.
 * Must render inside a react-leaflet MapContainer.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import L from "leaflet";
import { Marker } from "react-leaflet";
import { MAP_COLORS } from "@/lib/map-constants";
import { usePlanEnergy } from "@/hooks/use-planner-flight-plan";
import type { Waypoint } from "@/lib/types";

const badgeCache = new Map<string, L.DivIcon>();

/** The badge sits up and right of the waypoint icon, clear of its number. */
function badgeIcon(pack: number, label: string): L.DivIcon {
  const key = `${pack}|${label}`;
  const cached = badgeCache.get(key);
  if (cached) return cached;
  const icon = L.divIcon({
    className: "",
    iconSize: [28, 14],
    iconAnchor: [-6, 22],
    html: `<div role="img" aria-label="${label}" style="font:600 10px 'JetBrains Mono',monospace;line-height:14px;padding:0 3px;white-space:nowrap;color:${MAP_COLORS.background};background:${MAP_COLORS.jump};border-radius:3px;display:inline-block">⚡${pack}</div>`,
  });
  badgeCache.set(key, icon);
  return icon;
}

export function BatteryChangeBadges({ waypoints }: { waypoints: Waypoint[] }) {
  const t = useTranslations("planner.map");
  const { energy } = usePlanEnergy();
  const badges = useMemo(
    () =>
      (energy?.packs ?? []).slice(1).flatMap((split, i) => {
        const wp = waypoints[split.fromIndex];
        return wp ? [{ key: `pack-${i + 2}-${wp.id}`, pack: i + 2, position: [wp.lat, wp.lon] as [number, number] }] : [];
      }),
    [energy, waypoints],
  );
  return (
    <>
      {badges.map((b) => (
        <Marker key={b.key} position={b.position} icon={badgeIcon(b.pack, t("packStarts", { n: b.pack }))} interactive={false} />
      ))}
    </>
  );
}
