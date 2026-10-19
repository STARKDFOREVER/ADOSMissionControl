"use client";

/**
 * @module ground-station/RssiSparkline
 * @description Fixed-size inline SVG sparkline over one receive chain's RSSI
 * ring. The scale is fixed (-100 to -30 dBm) so chains and adapters compare
 * at a glance and a live update never shifts the layout. Renders an empty
 * box of the same size until two samples exist.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import type { RingBuffer } from "@/lib/ring-buffer";

const WIDTH = 72;
const HEIGHT = 16;
const MIN_DBM = -100;
const MAX_DBM = -30;

interface RssiSparklineProps {
  ring: RingBuffer<number> | undefined;
  /** Store revision; the ring mutates in place, so this keys the memo. */
  rev: number;
  label: string;
}

export function RssiSparkline({ ring, rev, label }: RssiSparklineProps) {
  const points = useMemo(() => {
    const values = ring?.toArray() ?? [];
    if (values.length < 2) return null;
    const step = WIDTH / (values.length - 1);
    return values
      .map((v, i) => {
        const clamped = Math.min(MAX_DBM, Math.max(MIN_DBM, v));
        const y = HEIGHT - ((clamped - MIN_DBM) / (MAX_DBM - MIN_DBM)) * HEIGHT;
        return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    // `rev` invalidates the memo when the ring gains a sample in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring, rev]);

  return (
    <svg
      role="img"
      aria-label={label}
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="shrink-0 text-accent-primary"
      data-samples={ring?.length ?? 0}
    >
      {points ? (
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.25} />
      ) : null}
    </svg>
  );
}
