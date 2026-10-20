/**
 * @module use-terrain-profile
 * @description Terrain elevation along a mission path, for the planner.
 *
 * - `useTerrainProfile` builds the chart profile: ground sampled at every
 *   waypoint and at most 30 m apart between them (debounced, abortable). Each
 *   caller runs its own sampling; repeated points are answered by the shared
 *   elevation cache rather than the network. Returns `status: "unavailable"`
 *   (not an empty profile) when the elevation data can't be fetched, so
 *   callers show an honest offline state instead of a flat baseline.
 * - `useLegGroundProfiles` gives the ground under every flown leg, for the
 *   leg terrain-clearance check. Sampling is shared at module level: every
 *   component asking for the same legs triggers one fetch per leg.
 *
 * @license GPL-3.0-only
 */
"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Waypoint } from "@/lib/types";
import type { TerrainProfile } from "@/lib/terrain/types";
import { computeTerrainProfile } from "@/lib/terrain/terrain-profile";
import { sampleGroundAlong } from "@/lib/terrain/ground-sampler";
import { isFlownCommand } from "@/lib/mission/command-classes";

export type TerrainProfileStatus = "idle" | "loading" | "ready" | "unavailable";

/** Largest gap between ground samples along a leg, metres. */
export const LEG_SAMPLE_SPACING_M = 30;

const DEBOUNCE_MS = 500;

/**
 * Fetch the terrain profile for `waypoints` (debounced 500ms, previous request
 * aborted on change), sampled at most `spacingM` apart along each leg.
 */
export function useTerrainProfile(
  waypoints: Waypoint[],
  spacingM = LEG_SAMPLE_SPACING_M,
): { profile: TerrainProfile | null; status: TerrainProfileStatus } {
  const [profile, setProfile] = useState<TerrainProfile | null>(null);
  const [status, setStatus] = useState<TerrainProfileStatus>("idle");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (waypoints.length < 2) {
      setProfile(null);
      setStatus("idle");
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      setStatus("loading");
      computeTerrainProfile(waypoints, spacingM, controller.signal)
        .then((p) => {
          if (controller.signal.aborted) return;
          if (!p || p.points.length === 0) {
            setProfile(null);
            setStatus("unavailable");
          } else {
            setProfile(p);
            setStatus("ready");
          }
        })
        .catch((err) => {
          if ((err as Error).name === "AbortError") return;
          if (!controller.signal.aborted) {
            setProfile(null);
            setStatus("unavailable");
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [waypoints, spacingM]);

  return { profile, status };
}

// ── Leg ground profiles ─────────────────────────────────────────────────────

interface Leg {
  /** `${fromId}>${toId}`: the key the validator reads. */
  key: string;
  /** Exact endpoint geometry: the shared cache key, independent of ids. */
  geom: string;
  a: { lat: number; lon: number };
  b: { lat: number; lon: number };
}

/** Most leg profiles kept in memory; the elevation cache keeps the rest cheap. */
const MAX_CACHED_LEGS = 2_000;

/** Ground AMSL along each fully resolved leg, by geometry (insertion = age). */
const legGround = new Map<string, number[]>();
/** Legs being sampled now. */
const inflight = new Set<string>();
/** Legs whose last sampling left a sample unresolved; retried on the next request. */
const failed = new Set<string>();
const listeners = new Set<() => void>();

/**
 * Consecutive flown waypoints with a position of their own. RTL flies to home
 * (or a rally point), not to its own coordinates, and a 0/0 item flies where
 * the vehicle already is, so neither starts nor ends a leg here. Nothing after
 * the first LAND, VTOL_LAND or RTL is flown.
 */
export function flownLegs(waypoints: readonly Waypoint[]): Leg[] {
  const legs: Leg[] = [];
  let prev: Waypoint | null = null;
  for (const wp of waypoints) {
    const command = wp.command ?? "WAYPOINT";
    if (command === "RTL") break;
    if (!isFlownCommand(command) || wp.inheritsPosition || (wp.lat === 0 && wp.lon === 0)) continue;
    if (prev) {
      legs.push({
        key: `${prev.id}>${wp.id}`,
        geom: `${prev.lat},${prev.lon}>${wp.lat},${wp.lon}`,
        a: { lat: prev.lat, lon: prev.lon },
        b: { lat: wp.lat, lon: wp.lon },
      });
    }
    if (command === "LAND" || command === "VTOL_LAND") break;
    prev = wp;
  }
  return legs;
}

function requestLegs(legs: readonly Leg[]): void {
  for (const leg of legs) {
    if (legGround.has(leg.geom) || inflight.has(leg.geom)) continue;
    inflight.add(leg.geom);
    failed.delete(leg.geom);
    sampleGroundAlong(leg.a, leg.b, LEG_SAMPLE_SPACING_M)
      .then((samples) => {
        const ground = samples.map((s) => s.groundAmsl);
        if (ground.some((g) => g === null)) {
          failed.add(leg.geom);
          return;
        }
        legGround.set(leg.geom, ground as number[]);
        if (legGround.size > MAX_CACHED_LEGS) {
          const oldest = legGround.keys().next().value;
          if (oldest !== undefined) legGround.delete(oldest);
        }
      })
      .catch(() => {
        failed.add(leg.geom);
      })
      .finally(() => {
        inflight.delete(leg.geom);
        for (const l of listeners) l();
      });
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Most leg-profile maps kept for identity reuse. */
const MAX_CACHED_PROFILES = 64;
/** Last map handed out per leg signature, so an unchanged result keeps its identity. */
const profilesBySignature = new Map<string, Map<string, number[]>>();

function profilesFor(signature: string, legs: readonly Leg[]): Map<string, number[]> | undefined {
  const known: Array<[string, number[]]> = [];
  let pending = false;
  for (const l of legs) {
    const ground = legGround.get(l.geom);
    if (ground) known.push([l.key, ground]);
    else if (!failed.has(l.geom)) pending = true;
  }
  if (pending && known.length === 0) return undefined;
  const prev = profilesBySignature.get(signature);
  if (prev && prev.size === known.length && known.every(([k, v]) => prev.get(k) === v)) return prev;
  const next = new Map(known);
  profilesBySignature.delete(signature);
  profilesBySignature.set(signature, next);
  if (profilesBySignature.size > MAX_CACHED_PROFILES) {
    const oldest = profilesBySignature.keys().next().value;
    if (oldest !== undefined) profilesBySignature.delete(oldest);
  }
  return next;
}

/**
 * Ground elevation (metres AMSL) under every flown leg, keyed
 * `${fromId}>${toId}`, sampled evenly at most 30 m apart from the from-waypoint
 * to the to-waypoint inclusive. A leg with any unresolved sample is left out,
 * so the caller reports it unchecked rather than clear.
 *
 * `undefined` while the first sampling is in flight (no leg known yet). While
 * edited legs are re-sampled, the map holds the legs already known and omits
 * the pending ones. The returned Map keeps its identity while its contents are
 * unchanged.
 */
export function useLegGroundProfiles(
  waypoints: readonly Waypoint[],
): Map<string, number[]> | undefined {
  const legs = useMemo(() => flownLegs(waypoints), [waypoints]);
  const signature = useMemo(() => legs.map((l) => `${l.key}@${l.geom}`).join("|"), [legs]);

  useEffect(() => {
    if (legs.length === 0) return;
    const timer = setTimeout(() => requestLegs(legs), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [legs]);

  const snapshot = () => profilesFor(signature, legs);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
