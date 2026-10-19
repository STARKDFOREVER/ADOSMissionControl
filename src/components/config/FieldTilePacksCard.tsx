/**
 * @module FieldTilePacksCard
 * @description Read-only list of the vector tile packs the paired ground
 * station serves over the LAN, for Settings > Data. Shown only while a ground
 * station that advertises tile packs is reachable.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { formatBytes } from "@/lib/tile-math";
import { useFieldTilePacks } from "@/hooks/use-field-tile-packs";

export function FieldTilePacksCard() {
  const t = useTranslations("offlineMapManager.fieldPacks");
  const source = useFieldTilePacks();
  if (!source) return null;

  return (
    <Card title={t("title")} padding={true}>
      <div className="flex flex-col gap-2">
        <p className="text-[11px] text-text-tertiary">{t("help", { host: source.baseUrl })}</p>
        {source.packs.length === 0 ? (
          <p className="text-[11px] text-text-secondary">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {source.packs.map((pack) => (
              <li key={pack.name} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-text-primary">{pack.name}</span>
                <span className="shrink-0 font-mono text-text-secondary">
                  {t("detail", {
                    min: pack.minzoom,
                    max: pack.maxzoom,
                    size: formatBytes(pack.size_bytes),
                  })}
                </span>
                {!pack.usable && (
                  <span className="shrink-0 text-status-warning">{t("notVector", { type: pack.tile_type })}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
