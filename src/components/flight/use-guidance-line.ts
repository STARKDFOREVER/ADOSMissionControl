"use client";

import { useMemo } from "react";
import type { PathOptions } from "leaflet";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore, type GuidanceLineType } from "@/stores/settings-store";
import { getLineTypeDashArray } from "@/lib/drawing/geo-utils";

/** The three guidance vectors drawn from the drone marker. */
export type GuidanceLineKind = "hdg" | "trackWp" | "tgtHdg";

export interface GuidanceLineSettings {
  enabled: boolean;
  length: number;
  width: number;
  lineType: GuidanceLineType;
  color: string;
}

const SETTINGS_PREFIX = {
  hdg: "Hdg",
  trackWp: "TrackWp",
  tgtHdg: "TgtHdg",
} as const satisfies Record<GuidanceLineKind, string>;

const GUIDANCE_LINE_OPACITY = 0.8;

/** One guidance line's settings through a single shallow-compared selector. */
export function useGuidanceLine(kind: GuidanceLineKind): GuidanceLineSettings {
  const p = SETTINGS_PREFIX[kind];
  return useSettingsStore(
    useShallow((s) => ({
      enabled: s[`guidance${p}Enabled`],
      length: s[`guidance${p}Length`],
      width: s[`guidance${p}Width`],
      lineType: s[`guidance${p}LineType`],
      color: s[`guidance${p}Color`],
    })),
  );
}

/** Leaflet path options for a guidance line, stable while its style holds. */
export function useGuidancePathOptions(line: GuidanceLineSettings): PathOptions {
  const { color, width, lineType } = line;
  return useMemo(
    () => ({
      color,
      weight: width,
      dashArray: getLineTypeDashArray(lineType),
      opacity: GUIDANCE_LINE_OPACITY,
    }),
    [color, width, lineType],
  );
}
