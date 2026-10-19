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

let consumers = 0;
let pollKey = "";
let stopPoll: (() => void) | null = null;

function startPoll(ids: string[]): void {
  stopPoll?.();
  const controller = new AbortController();
  const load = () => {
    void findFieldTileSource(ids, controller.signal).then((found) => {
      if (!controller.signal.aborted) useFieldPackStore.getState().setSource(found);
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
      pollKey = groundIds;
      if (groundIds) startPoll(groundIds.split(","));
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
