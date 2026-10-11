"use client";

/**
 * @module CompassStreamCard
 * @description Compass raw stream UI. Subscribes to `MagneticFieldStrength2`
 * broadcasts from the selected node for the configured duration, plots
 * X/Y/Z over time on a small SVG, and exports the captured samples as a
 * CSV.
 *
 * @license GPL-3.0-only
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { Compass, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { MagneticFieldStrength2 } from "@/lib/dronecan/dsdl/magnetic-field-strength-2";
import { RingBuffer } from "@/lib/ring-buffer";
import { downloadBlob } from "@/lib/download";

interface MagSample {
  ts: number;
  x: number;
  y: number;
  z: number;
}

export interface CompassStreamClient {
  subscribeMag2(
    nodeId: number,
    cb: (mag: MagneticFieldStrength2) => void,
  ): () => void;
}

export interface CompassStreamCardProps {
  client?: CompassStreamClient | null;
}

const PLOT_WIDTH = 320;
const PLOT_HEIGHT = 80;
const MAX_SAMPLES = 5000;

export function CompassStreamCard({ client }: CompassStreamCardProps = {}) {
  const t = useTranslations("canConfig.testUtilities.compass");

  const [nodeIdRaw, setNodeIdRaw] = useState("");
  const [durationRaw, setDurationRaw] = useState("10");
  // Samples live in a ring (latest MAX_SAMPLES). Pushes bump `version` at
  // most once per animation frame; the plot reads a decimated view.
  const [ring] = useState(() => new RingBuffer<MagSample>(MAX_SAMPLES));
  const [version, setVersion] = useState(0);
  const rafRef = useRef<number | null>(null);
  const sampleCount = ring.length;
  const plot = useMemo(
    () => decimateMag(ring, PLOT_WIDTH),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the ring's change signal
    [ring, version],
  );
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const parsedNodeId = useMemo(() => {
    const n = Number.parseInt(nodeIdRaw, 10);
    return Number.isFinite(n) && n >= 1 && n <= 127 ? n : null;
  }, [nodeIdRaw]);

  const durationMs = useMemo(() => {
    const n = Number.parseInt(durationRaw, 10);
    return Number.isFinite(n) && n >= 1 ? n * 1000 : 0;
  }, [durationRaw]);

  const handleCapture = useCallback(() => {
    if (!client || parsedNodeId == null || durationMs <= 0) return;
    cleanup();
    setError(null);
    ring.clear();
    setVersion((v) => v + 1);
    setCapturing(true);
    try {
      const startedAt = Date.now();
      unsubRef.current = client.subscribeMag2(parsedNodeId, (mag) => {
        const [x, y, z] = mag.magneticFieldGa;
        ring.push({ ts: Date.now() - startedAt, x, y, z });
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            setVersion((v) => v + 1);
          });
        }
      });
      timerRef.current = setTimeout(() => {
        cleanup();
        setCapturing(false);
      }, durationMs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCapturing(false);
    }
  }, [client, parsedNodeId, durationMs, cleanup, ring]);

  const exportCsv = useCallback(() => {
    if (ring.length === 0) return;
    const lines = ["t_ms,x_ga,y_ga,z_ga"];
    ring.forEach((s) => {
      lines.push(`${s.ts},${s.x.toFixed(6)},${s.y.toFixed(6)},${s.z.toFixed(6)}`);
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    downloadBlob(blob, `compass-${Date.now()}.csv`);
  }, [ring]);

  return (
    <Card title={t("title")}>
      <div className="flex items-end gap-2 flex-wrap">
        <div className="w-32">
          <Input
            label={t("nodeId")}
            type="number"
            min={1}
            max={127}
            value={nodeIdRaw}
            onChange={(e) => setNodeIdRaw(e.target.value)}
            disabled={capturing}
          />
        </div>
        <div className="w-32">
          <Input
            label={t("duration")}
            type="number"
            min={1}
            value={durationRaw}
            onChange={(e) => setDurationRaw(e.target.value)}
            unit="s"
            disabled={capturing}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Compass size={12} />}
          onClick={handleCapture}
          disabled={
            !client || parsedNodeId == null || durationMs <= 0 || capturing
          }
          loading={capturing}
        >
          {t("button")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Gauge size={12} />}
          onClick={exportCsv}
          disabled={sampleCount === 0}
          data-testid="compass-export"
        >
          {t("exportCsv")}
        </Button>
        {error && (
          <span
            className="text-[11px] text-status-error"
            data-testid="compass-error"
          >
            {error}
          </span>
        )}
      </div>
      <div className="mt-3" data-testid="compass-plot">
        <CompassPlot plot={plot} />
      </div>
      <div className="mt-1 text-[10px] text-text-tertiary font-mono">
        {sampleCount} {t("samples")}
      </div>
    </Card>
  );
}

interface MagPlot {
  /** Per-axis decimated points (time-ordered), at most 2 per pixel column. */
  x: Array<[number, number]>;
  y: Array<[number, number]>;
  z: Array<[number, number]>;
  min: number;
  max: number;
  lastTs: number;
}

/**
 * Reduce the ring to at most two points (min and max) per pixel column for
 * each axis, so the SVG never carries more than 2 x `width` points per line.
 */
export function decimateMag(
  ring: RingBuffer<MagSample>,
  width: number,
): MagPlot {
  const plot: MagPlot = { x: [], y: [], z: [], min: 0, max: 0, lastTs: 1 };
  if (ring.length === 0) return plot;
  const lastTs = ring.latest()?.ts || 1;
  plot.lastTs = lastTs;
  const axes = ["x", "y", "z"] as const;
  let col = -1;
  const lo = { x: 0, y: 0, z: 0 };
  const hi = { x: 0, y: 0, z: 0 };
  const loTs = { x: 0, y: 0, z: 0 };
  const hiTs = { x: 0, y: 0, z: 0 };
  let first = true;
  const flush = () => {
    for (const a of axes) {
      if (lo[a] === hi[a]) {
        plot[a].push([loTs[a], lo[a]]);
      } else if (loTs[a] <= hiTs[a]) {
        plot[a].push([loTs[a], lo[a]], [hiTs[a], hi[a]]);
      } else {
        plot[a].push([hiTs[a], hi[a]], [loTs[a], lo[a]]);
      }
    }
  };
  ring.forEach((s) => {
    if (first) {
      plot.min = Math.min(s.x, s.y, s.z);
      plot.max = Math.max(s.x, s.y, s.z);
      first = false;
    } else {
      plot.min = Math.min(plot.min, s.x, s.y, s.z);
      plot.max = Math.max(plot.max, s.x, s.y, s.z);
    }
    const c = Math.min(width - 1, Math.floor((s.ts / lastTs) * width));
    if (c !== col) {
      if (col >= 0) flush();
      col = c;
      for (const a of axes) {
        lo[a] = hi[a] = s[a];
        loTs[a] = hiTs[a] = s.ts;
      }
      return;
    }
    for (const a of axes) {
      if (s[a] < lo[a]) {
        lo[a] = s[a];
        loTs[a] = s.ts;
      }
      if (s[a] > hi[a]) {
        hi[a] = s[a];
        hiTs[a] = s.ts;
      }
    }
  });
  flush();
  return plot;
}

function CompassPlot({ plot }: { plot: MagPlot }) {
  if (plot.x.length < 2) {
    return (
      <svg
        width={PLOT_WIDTH}
        height={PLOT_HEIGHT}
        className="bg-bg-secondary rounded"
      />
    );
  }
  const span = plot.max - plot.min || 1;
  const toPoints = (pts: Array<[number, number]>): string =>
    pts
      .map(([ts, v]) => {
        const xPx = (ts / plot.lastTs) * PLOT_WIDTH;
        const yPx = PLOT_HEIGHT - ((v - plot.min) / span) * PLOT_HEIGHT;
        return `${xPx.toFixed(1)},${yPx.toFixed(1)}`;
      })
      .join(" ");
  return (
    <svg
      width={PLOT_WIDTH}
      height={PLOT_HEIGHT}
      className="bg-bg-secondary rounded"
    >
      <polyline points={toPoints(plot.x)} fill="none" stroke="var(--color-status-error)" strokeWidth={1} />
      <polyline points={toPoints(plot.y)} fill="none" stroke="var(--color-status-success)" strokeWidth={1} />
      <polyline points={toPoints(plot.z)} fill="none" stroke="var(--color-accent-primary)" strokeWidth={1} />
    </svg>
  );
}
