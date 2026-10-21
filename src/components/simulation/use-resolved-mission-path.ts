/**
 * @module use-resolved-mission-path
 * @description Resolves a mission's waypoints to absolute 3D positions on the
 * viewer's terrain. Relative-frame altitudes are measured from the plan's
 * planned home, else the launch point the upload uses. Shared by the Simulate
 * viewer and the planner's 3D view.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import type { Cartesian3, Viewer as CesiumViewer } from "cesium";
import type { AltitudeFrame, Waypoint } from "@/lib/types";
import { createSimulationMissionSignature } from "@/lib/simulation-utils";
import { resolveAGLToAbsolute, type ResolvedPath } from "@/lib/terrain-utils";
import { planLaunchPoint } from "@/lib/mission/plan-home";
import { useFlightPlanOptions } from "@/hooks/use-rtl-return-context";
import { useTerrainReady } from "@/hooks/use-terrain-ready";

interface TerrainResultState {
  signature: string;
  path: ResolvedPath | null;
  failed: boolean;
}

export interface ResolvedMissionPath {
  missionSignature: string;
  resolvedPath: ResolvedPath | null;
  /** Waypoint-only resolved positions, in waypoint order. */
  waypointPositions: Cartesian3[] | undefined;
  terrainFailed: boolean;
  terrainResolving: boolean;
  terrainVersion: number;
}

export function useResolvedMissionPath(
  viewer: CesiumViewer | null,
  waypoints: Waypoint[],
  defaultSpeed: number,
  defaultFrame: AltitudeFrame,
): ResolvedMissionPath {
  // Relative-frame altitudes are measured from the plan's planned home, else
  // the launch point the upload uses (the first item with a position; a
  // TAKEOFF saved at 0/0 has none).
  const planOptions = useFlightPlanOptions();
  const launch = planLaunchPoint(waypoints);
  const homeLat = planOptions.home?.lat ?? launch?.lat;
  const homeLon = planOptions.home?.lon ?? launch?.lon;
  const homeGroundAmsl = planOptions.home?.groundAmsl;

  const missionSignature = useMemo(
    () => createSimulationMissionSignature(waypoints, defaultSpeed, defaultFrame),
    [waypoints, defaultSpeed, defaultFrame]
  );

  // Wait for the real terrain provider before sampling.
  const { isReady: terrainReady, version: terrainVersion } = useTerrainReady(viewer);

  const [terrainResult, setTerrainResult] = useState<TerrainResultState | null>(null);

  const resolvedPath =
    terrainResult?.signature === missionSignature && !terrainResult.failed
      ? terrainResult.path
      : null;
  const terrainFailed =
    terrainResult?.signature === missionSignature && terrainResult.failed;
  const terrainResolving =
    !!viewer && !viewer.isDestroyed() && waypoints.length >= 2 && !resolvedPath && !terrainFailed;

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || waypoints.length < 2) {
      return;
    }

    // Don't sample while terrain provider is still the flat ellipsoid —
    // it returns height=0 everywhere, placing the path underground.
    if (!terrainReady) {
      return;
    }

    let cancelled = false;
    const terrainProvider = viewer.scene.globe.terrainProvider;
    const signature = missionSignature;

    if (homeLat === undefined || homeLon === undefined) return;
    resolveAGLToAbsolute(waypoints, terrainProvider, defaultFrame, { lat: homeLat, lon: homeLon, groundAmsl: homeGroundAmsl })
      .then((result) => {
        if (!cancelled) {
          setTerrainResult({ signature, path: result, failed: false });
        }
      })
      .catch(() => {
        // Terrain sampling failed — FlightPathEntity falls back to clamped path
        if (!cancelled) {
          setTerrainResult({ signature, path: null, failed: true });
        }
      });

    return () => { cancelled = true; };
  }, [viewer, missionSignature, waypoints, defaultFrame, terrainReady, terrainVersion, homeLat, homeLon, homeGroundAmsl]);

  // Extract waypoint-only resolved positions for WaypointEntities + camera
  const waypointPositions = useMemo(() => {
    if (!resolvedPath) return undefined;
    return resolvedPath.waypointIndices.map((idx) => resolvedPath.positions[idx]);
  }, [resolvedPath]);

  return { missionSignature, resolvedPath, waypointPositions, terrainFailed, terrainResolving, terrainVersion };
}
