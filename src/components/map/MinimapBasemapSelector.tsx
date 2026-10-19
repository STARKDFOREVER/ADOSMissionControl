"use client";

/**
 * @module map/MinimapBasemapSelector
 * @description A compact map-type selector for the cockpit minimap — the basemap
 * segments only (DARK / OSM / SAT / TOPO / STREETS / LIGHT, plus CUSTOM once
 * configured and FIELD while a paired ground station serves a tile pack), with no
 * NFZ toggle and no click-to-expand. It writes the shared `mapTileSource`
 * setting, so both the minimap and the full map follow the choice. The basemap
 * catalog is shared from `@/lib/tile-math`, a pure module, so importing this
 * client component still pulls no Leaflet into an SSR pass.
 * @license GPL-3.0-only
 */

import { useSettingsStore, type MapTileSource } from "@/stores/settings-store";
import { BASEMAP_ORDER, basemapLabel, validateTileUrlTemplate } from "@/lib/tile-math";
import { useFieldTilePacks } from "@/hooks/use-field-tile-packs";
import { activeFieldPack, useFieldPackStore } from "@/stores/field-pack-store";
import { BasemapSwitcher } from "./BasemapSwitcher";
import { useTranslations } from "next-intl";

export function MinimapBasemapSelector({ className }: { className?: string }) {
  const t = useTranslations("basemap");
  const source = useSettingsStore((s) => s.mapTileSource);
  const setSource = useSettingsStore((s) => s.setMapTileSource);
  // This surface carries no editor, so an unconfigured custom source would be
  // a segment that selects a fallback basemap. Hide it until it is usable.
  const customTileUrl = useSettingsStore((s) => s.customTileUrl);
  const customUsable = validateTileUrlTemplate(customTileUrl) === null;
  const fieldSource = useFieldTilePacks();
  const fieldPack = activeFieldPack(fieldSource, useFieldPackStore((s) => s.selectedPack));
  const options = [...BASEMAP_ORDER, ...(fieldPack || source === "field-pack" ? ["field-pack" as const] : [])]
    .filter((s) => s !== "custom" || customUsable || source === "custom")
    .map((s) => ({
      value: s,
      label: basemapLabel(s),
      title: s === "field-pack" && fieldPack ? t("fieldPackActive", { name: fieldPack.name }) : undefined,
    }));
  return (
    <BasemapSwitcher
      className={className}
      value={source}
      onChange={(v) => setSource(v as MapTileSource)}
      options={options}
    />
  );
}
