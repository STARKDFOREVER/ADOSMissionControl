/**
 * @module use-planner-3d-camera
 * @description Camera framing for the planner's 3D view: frames the mission as
 * its terrain-resolved positions settle (until the operator first moves the
 * camera), falls back to the last map centre for an empty plan, and follows
 * the planner's fit and pan requests.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";
import {
  BoundingSphere,
  Cartesian3,
  Cartographic,
  HeadingPitchRange,
  Math as CesiumMath,
  type Viewer as CesiumViewer,
} from "cesium";
import { usePlannerStore } from "@/stores/planner-store";

/** Smallest framed radius, so a one-waypoint plan is not viewed from inside it. */
const MIN_FIT_RADIUS_M = 200;
/** Camera distance as a multiple of the framed radius. */
const FIT_RANGE_FACTOR = 3;
/** Height above the ground for the empty-plan view. */
const EMPTY_VIEW_HEIGHT_M = 1500;

function fitPositions(viewer: CesiumViewer, positions: Cartesian3[]): void {
  const sphere = BoundingSphere.fromPoints(positions);
  sphere.radius = Math.max(sphere.radius, MIN_FIT_RADIUS_M);
  viewer.camera.flyToBoundingSphere(sphere, {
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(-35), sphere.radius * FIT_RANGE_FACTOR),
    duration: 0,
  });
  viewer.scene.requestRender();
}

function viewMapCenter(viewer: CesiumViewer): void {
  const [lat, lon] = usePlannerStore.getState().mapCenter;
  const ground = viewer.scene.globe.getHeight(Cartographic.fromDegrees(lon, lat)) ?? 0;
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(lon, lat, ground + EMPTY_VIEW_HEIGHT_M),
    orientation: { heading: 0, pitch: CesiumMath.toRadians(-45), roll: 0 },
  });
  viewer.scene.requestRender();
}

/**
 * @param positions The waypoint positions to frame, or undefined while they are
 * still being resolved. An empty array means the plan has no waypoints.
 */
export function usePlanner3DCamera(viewer: CesiumViewer | null, positions: Cartesian3[] | undefined): void {
  const fitRequestTs = usePlannerStore((s) => s.fitRequestTs);
  const panRequest = usePlannerStore((s) => s.panRequest);
  // The view follows the mission's positions (they settle as terrain and
  // imagery load) until the operator first touches the scene.
  const userMovedRef = useRef(false);
  const emptyViewRef = useRef(false);
  const positionsRef = useRef(positions);
  useEffect(() => { positionsRef.current = positions; }, [positions]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const canvas = viewer.scene.canvas;
    const markMoved = () => { userMovedRef.current = true; };
    canvas.addEventListener("pointerdown", markMoved);
    canvas.addEventListener("wheel", markMoved, { passive: true });
    return () => {
      canvas.removeEventListener("pointerdown", markMoved);
      canvas.removeEventListener("wheel", markMoved);
    };
  }, [viewer]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || userMovedRef.current || positions === undefined) return;
    if (positions.length > 0) {
      fitPositions(viewer, positions);
    } else if (!emptyViewRef.current) {
      emptyViewRef.current = true;
      viewMapCenter(viewer);
    }
  }, [viewer, positions]);

  // Fit on request (the planner's "fit mission" action).
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || fitRequestTs === 0) return;
    const current = positionsRef.current;
    if (current && current.length > 0) fitPositions(viewer, current);
    usePlannerStore.getState().clearFitRequest();
  }, [viewer, fitRequestTs]);

  // Pan on request, keeping the current camera height.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !panRequest) return;
    const height = viewer.camera.positionCartographic.height;
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(panRequest.lon, panRequest.lat, height),
      orientation: { heading: viewer.camera.heading, pitch: viewer.camera.pitch, roll: 0 },
      duration: 0.8,
    });
    viewer.scene.requestRender();
    usePlannerStore.getState().clearPanRequest();
  }, [viewer, panRequest]);
}
