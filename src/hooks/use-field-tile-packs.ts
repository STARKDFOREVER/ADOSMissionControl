/**
 * @module use-field-tile-packs
 * @description Keeps `field-pack-store.source` current while any consumer is
 * mounted: one shared poll of the paired ground stations, however many map
 * surfaces ask, re-run when the set of ground stations changes.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect } from "react";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { useFieldPackStore, type FieldTileSource } from "@/stores/field-pack-store";
import { findFieldTileSource } from "@/lib/agent/field-tile-packs";

/** How often the pack list is re-read while a consumer is mounted. */
const REFRESH_MS = 60_000;
/** Consecutive failed reads before a reachable pack is dropped. */
const MAX_FAILURES = 3;

let consumers = 0;
let pollKey = "";
let stopPoll: (() => void) | null = null;

/**
 * Polls `ids`. A new id list clears the previous source once; after that a
 * single failed read keeps the last pack, and only MAX_FAILURES in a row drop it.
 */
function startPoll(ids: string[], idsChanged: boolean): void {
  stopPoll?.();
  if (idsChanged) useFieldPackStore.getState().setSource(null);
  const controller = new AbortController();
  let failures = 0;
  const load = () => {
    void findFieldTileSource(ids, controller.signal)
      .catch(() => null)
      .then((found) => {
        if (controller.signal.aborted) return;
        if (found) {
          failures = 0;
          useFieldPackStore.getState().setSource(found);
        } else if (++failures >= MAX_FAILURES) {
          useFieldPackStore.getState().setSource(null);
        }
      });
  };
  load();
  const timer = setInterval(load, REFRESH_MS);
  stopPoll = () => {
    controller.abort();
    clearInterval(timer);
    stopPoll = null;
  };
}

/** The paired ground station's tile packs, or null when none is reachable. */
export function useFieldTilePacks(): FieldTileSource | null {
  const groundIds = useLocalNodesStore((s) =>
    s.nodes.filter((n) => n.profile === "ground-station").map((n) => n.deviceId).join(","),
  );

  useEffect(() => {
    consumers += 1;
    if (groundIds !== pollKey || !stopPoll) {
      const idsChanged = groundIds !== pollKey;
      pollKey = groundIds;
      if (groundIds) startPoll(groundIds.split(","), idsChanged);
      else {
        stopPoll?.();
        useFieldPackStore.getState().setSource(null);
      }
    }
    return () => {
      consumers -= 1;
      if (consumers === 0) {
        stopPoll?.();
        pollKey = "";
      }
    };
  }, [groundIds]);

  return useFieldPackStore((s) => s.source);
}
