/**
 * @module use-terrain-prefetch
 * @description Ground-elevation download for the offline area panel: runs
 * `prefetchElevationGrid` over an area and reports its own progress, result
 * and error, apart from the tile download it runs beside. Cancel and unmount
 * abort the request; an aborted run returns to idle without an error.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { prefetchElevationGrid } from "@/lib/terrain/terrain-provider";

/** Why a terrain download did not finish. */
export type TerrainPrefetchError = { kind: "tooLarge" } | { kind: "failed"; reason: string };

export interface TerrainPrefetchState {
  running: boolean;
  /** Elevation tiles done of the area's total, while running. */
  progress: { done: number; total: number } | null;
  result: { fetched: number; failed: number } | null;
  error: TerrainPrefetchError | null;
}

const IDLE: TerrainPrefetchState = { running: false, progress: null, result: null, error: null };

/** The message `prefetchElevationGrid` throws for an area over its tile limit. */
const TOO_LARGE_MESSAGE = "Area too large for terrain download";

export function useTerrainPrefetch() {
  const [state, setState] = useState<TerrainPrefetchState>(IDLE);
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback(async (bounds: { north: number; south: number; east: number; west: number }) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ running: true, progress: null, result: null, error: null });
    try {
      const result = await prefetchElevationGrid(
        bounds,
        (done, total) => {
          if (controllerRef.current === controller) setState((s) => ({ ...s, progress: { done, total } }));
        },
        controller.signal,
      );
      if (controllerRef.current === controller) setState({ running: false, progress: null, result, error: null });
    } catch (err) {
      if (controllerRef.current !== controller) return;
      if (controller.signal.aborted) {
        setState(IDLE);
        return;
      }
      const tooLarge = err instanceof RangeError && err.message === TOO_LARGE_MESSAGE;
      setState({
        running: false,
        progress: null,
        result: null,
        error: tooLarge ? { kind: "tooLarge" } : { kind: "failed", reason: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  const clear = useCallback(() => setState(IDLE), []);

  // Closing the panel stops the download.
  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, start, cancel, clear };
}
