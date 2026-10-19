/**
 * @module VectorBasemapLayer
 * @description Draws a vector (MVT) basemap under the Leaflet map with
 * MapLibre, styled by the Protomaps basemap layers. Labels follow the app
 * locale where the style carries that language. Fonts, sprites and the
 * MapLibre worker are served from `/basemap-assets/`. MapLibre is loaded on
 * first use, so raster-only sessions never download it.
 *
 * `authBaseUrl` + `apiKey` add an `X-ADOS-Key` header to requests under that
 * base URL (tiles served by a paired agent); every other request is unchanged.
 * @license GPL-3.0-only
 */

"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { useLocale } from "next-intl";
import type L from "leaflet";
import type { StyleSpecification } from "maplibre-gl";
import { useTileHealthStore } from "@/stores/tile-health-store";

export interface VectorBasemapLayerProps {
  /** MVT template, `{z}/{x}/{y}`. */
  url: string;
  /** Highest zoom the source has tiles for; MapLibre overzooms past it. */
  maxZoom: number;
  attribution: string;
  flavor: "dark" | "light";
  authBaseUrl?: string;
  apiKey?: string;
}

const ASSETS_PATH = "/basemap-assets";
const SOURCE_ID = "protomaps";
/** Deepest zoom the map allows on a vector basemap (tiles are overzoomed). */
const MAX_DISPLAY_ZOOM = 20;
/** App locales whose label language the style calls by another code. */
const STYLE_LANG: Record<string, string> = { zh: "zh-Hans" };

let workerUrlSet = false;

export function VectorBasemapLayer({
  url,
  maxZoom,
  attribution,
  flavor,
  authBaseUrl,
  apiKey,
}: VectorBasemapLayerProps) {
  const map = useMap();
  const locale = useLocale();

  useEffect(() => {
    let cancelled = false;
    let layer: L.Layer | null = null;
    useTileHealthStore.getState().observe(url);

    (async () => {
      const [maplibre, { maplibreGL }, basemaps] = await Promise.all([
        import("maplibre-gl"),
        import("@maplibre/maplibre-gl-leaflet"),
        import("@protomaps/basemaps"),
      ]);
      if (cancelled) return;
      if (!workerUrlSet) {
        // Bundled MapLibre cannot find its worker beside itself; the copy in
        // public/ is versioned so a cached old worker is never reused.
        maplibre.setWorkerUrl(`${ASSETS_PATH}/maplibre-gl-worker.mjs?v=${maplibre.getVersion()}`);
        workerUrlSet = true;
      }

      const wanted = STYLE_LANG[locale] ?? locale;
      const lang = basemaps.language_script_pairs.some((p) => p.lang === wanted) ? wanted : "en";
      const origin = window.location.origin;
      const style: StyleSpecification = {
        version: 8,
        glyphs: `${origin}${ASSETS_PATH}/fonts/{fontstack}/{range}.pbf`,
        sprite: `${origin}${ASSETS_PATH}/sprites/v4/${flavor}`,
        sources: {
          [SOURCE_ID]: { type: "vector", tiles: [url], maxzoom: maxZoom, attribution },
        },
        layers: basemaps.layers(SOURCE_ID, basemaps.namedFlavor(flavor), { lang }),
      };

      const gl = maplibreGL({
        style,
        maxZoom: MAX_DISPLAY_ZOOM,
        transformRequest: (requestUrl) =>
          authBaseUrl && apiKey && requestUrl.startsWith(authBaseUrl)
            ? { url: requestUrl, headers: { "X-ADOS-Key": apiKey } }
            : { url: requestUrl },
      });
      try {
        gl.addTo(map);
      } catch (err) {
        console.warn("[VectorBasemapLayer] skipped stale map layer attach", err);
        return;
      }
      layer = gl;
      // Leaflet bounds the map's zoom only by tile layers, so with a vector
      // basemap alone the map would zoom without limit. Register this layer's
      // maxZoom the way a tile layer does; removeLayer drops it again.
      if ("_addZoomLimit" in map && typeof map._addZoomLimit === "function") map._addZoomLimit(gl);
      const glMap = gl.getMaplibreMap();
      glMap.on("data", (e) => {
        if (e.dataType === "source" && "tile" in e && e.tile) useTileHealthStore.getState().recordLoad();
      });
      glMap.on("error", (e) => {
        const err: unknown = e.error;
        const failedUrl =
          err && typeof err === "object" && "url" in err && typeof err.url === "string" ? err.url : null;
        useTileHealthStore.getState().recordError(failedUrl);
      });
    })().catch((err) => console.warn("[VectorBasemapLayer] could not load the vector basemap", err));

    return () => {
      cancelled = true;
      if (!layer) return;
      try {
        map.removeLayer(layer);
      } catch {
        /* map may already be destroyed during dev reconnect */
      }
    };
  }, [map, url, maxZoom, attribution, flavor, authBaseUrl, apiKey, locale]);

  return null;
}
