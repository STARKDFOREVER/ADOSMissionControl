/**
 * @module BasemapSwitcher
 * @description Shared segmented basemap/imagery selector used by both the Plan
 * (Leaflet) and Simulate (Cesium) map views so the control reads the same in
 * both tabs. Presentational only — the caller owns the option set and the
 * persisted value, since the two engines expose different basemap catalogs.
 * @license GPL-3.0-only
 */
"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";

export interface BasemapOption {
  value: string;
  label: string;
  /** Hover text, e.g. the full name behind a short label. */
  title?: string;
}

interface BasemapSwitcherProps {
  options: BasemapOption[];
  value: string;
  onChange: (value: string) => void;
  /** Stretch each segment to equal width to fill the container. */
  stretch?: boolean;
  className?: string;
  /** Accessible name for the group. Defaults to the option labels. */
  ariaLabel?: string;
}

export function BasemapSwitcher({
  options,
  value,
  onChange,
  stretch,
  className,
  ariaLabel,
}: BasemapSwitcherProps) {
  return (
    <SegmentedControl
      value={value}
      options={options}
      onChange={onChange}
      stretch={stretch}
      className={className}
      ariaLabel={ariaLabel ?? options.map((o) => o.label).join(" / ")}
      segmentClassName="text-[10px] font-mono font-bold"
    />
  );
}
