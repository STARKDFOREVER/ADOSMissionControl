/**
 * @module use-planner-3d-input
 * @description Pointer input for the planner's 3D view. Clicks place and
 * select through the same planner handlers the 2D map uses; a left-drag on a
 * waypoint moves it over the ground, Alt+left-drag changes its altitude, and
 * Escape cancels a drag in progress. One ScreenSpaceEventHandler, destroyed on
 * unmount.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  ConstantPositionProperty,
  HeightReference,
  KeyboardEventModifier,
  Math as CesiumMath,
  PerspectiveFrustum,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  type Entity,
  type Viewer as CesiumViewer,
} from "cesium";
import type { AltitudeFrame, Waypoint } from "@/lib/types";
import { useMissionStore } from "@/stores/mission-store";
import type { PlannerMapProps } from "../PlannerMap";
import { altitudeFromDrag, metersPerPixel } from "./drag-math";

const WP_ENTITY_PREFIX = "sim-wp-";
/** Pointer travel that turns a press on a waypoint into a drag. */
const DRAG_THRESHOLD_PX = 4;
const MODIFIERS = [undefined, KeyboardEventModifier.ALT, KeyboardEventModifier.CTRL, KeyboardEventModifier.SHIFT];

export type Planner3DInputHandlers = Pick<
  PlannerMapProps,
  "onMapClick" | "onMapRightClick" | "onWaypointClick" | "onWaypointRightClick" | "onWaypointDragEnd"
>;

interface DragState {
  id: string;
  entity: Entity;
  start: Cartesian2;
  startCart: Cartesian3;
  startCarto: Cartographic;
  /** The entity's height above the ground at the press (absolute-height entities). */
  startAboveGround: number;
  relativeToGround: boolean;
  startAlt: number;
  frame: AltitudeFrame;
  altMode: boolean;
  started: boolean;
  last: { lat: number; lon: number; alt: number } | null;
}

/** The waypoint id under a screen position, or null. */
function pickWaypointId(viewer: CesiumViewer, pos: Cartesian2): string | null {
  const picked = viewer.scene.pick(pos);
  const id: unknown = defined(picked) ? picked.id?.id : undefined;
  return typeof id === "string" && id.startsWith(WP_ENTITY_PREFIX) ? id.slice(WP_ENTITY_PREFIX.length) : null;
}

/** Ground (or building) position under the cursor, in degrees and metres. */
function groundPick(viewer: CesiumViewer, pos: Cartesian2): Cartographic | null {
  const scene = viewer.scene;
  let cart: Cartesian3 | undefined;
  if (scene.pickPositionSupported) cart = scene.pickPosition(pos);
  if (!defined(cart)) cart = viewer.camera.pickEllipsoid(pos, scene.globe.ellipsoid);
  return defined(cart) ? Cartographic.fromCartesian(cart) : null;
}

/** Terrain under the cursor, ignoring entities (the dragged point and the path). */
function terrainPick(viewer: CesiumViewer, pos: Cartesian2): Cartographic | null {
  const ray = viewer.camera.getPickRay(pos);
  const cart = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
  return defined(cart) ? Cartographic.fromCartesian(cart) : groundPick(viewer, pos);
}

export function usePlanner3DInput(
  viewer: CesiumViewer | null,
  handlers: Planner3DInputHandlers,
  waypoints: Waypoint[],
  defaultFrame: AltitudeFrame,
): void {
  const ref = useRef({ handlers, waypoints, defaultFrame });
  useEffect(() => { ref.current = { handlers, waypoints, defaultFrame }; }, [handlers, waypoints, defaultFrame]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const scene = viewer.scene;
    const canvas = scene.canvas;
    const mods = { ctrl: false, meta: false, shift: false, alt: false };
    const trackMods = (e: KeyboardEvent | PointerEvent) => {
      mods.ctrl = e.ctrlKey; mods.meta = e.metaKey; mods.shift = e.shiftKey; mods.alt = e.altKey;
    };
    let drag: DragState | null = null;
    let suppressClick = false;

    const setInputs = (on: boolean) => { scene.screenSpaceCameraController.enableInputs = on; };
    const setEntityPosition = (entity: Entity, cart: Cartesian3) => {
      entity.position = new ConstantPositionProperty(cart);
    };
    const toDeg = (c: Cartographic) => ({ lat: CesiumMath.toDegrees(c.latitude), lon: CesiumMath.toDegrees(c.longitude) });

    const cancelDrag = () => {
      if (!drag) return;
      setEntityPosition(drag.entity, drag.startCart);
      drag = null;
      setInputs(true);
      scene.requestRender();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      trackMods(e);
      if (e.key === "Escape" && drag) {
        // Consume it so the planner's Escape (clear selection) does not also run.
        e.preventDefault();
        e.stopPropagation();
        cancelDrag();
      }
    };
    const onBlur = () => { mods.ctrl = mods.meta = mods.shift = mods.alt = false; cancelDrag(); };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", trackMods, true);
    window.addEventListener("blur", onBlur);
    canvas.addEventListener("pointerdown", trackMods, true);

    const leftDown = (e: { position: Cartesian2 }) => {
      scene.requestRender();
      if (mods.ctrl || mods.meta || mods.shift) return;
      const id = pickWaypointId(viewer, e.position);
      const entity = id ? viewer.entities.getById(`${WP_ENTITY_PREFIX}${id}`) : undefined;
      const wp = id ? ref.current.waypoints.find((w) => w.id === id) : undefined;
      const startCart = entity?.position?.getValue(viewer.clock.currentTime);
      if (!id || !entity || !wp || !startCart) return;
      const startCarto = Cartographic.fromCartesian(startCart);
      const ground = scene.globe.getHeight(startCarto) ?? 0;
      drag = {
        id, entity, start: Cartesian2.clone(e.position), startCart: Cartesian3.clone(startCart), startCarto,
        startAboveGround: startCarto.height - ground,
        relativeToGround: entity.point?.heightReference?.getValue(viewer.clock.currentTime) === HeightReference.RELATIVE_TO_GROUND,
        startAlt: wp.alt, frame: wp.frame ?? ref.current.defaultFrame,
        altMode: mods.alt, started: false, last: null,
      };
      // Hold the camera from the press on, so the globe does not spin under a
      // waypoint that is about to be dragged.
      setInputs(false);
    };

    const mouseMove = (e: { endPosition: Cartesian2 }) => {
      if (!drag) return;
      if (!drag.started) {
        if (Cartesian2.distance(drag.start, e.endPosition) <= DRAG_THRESHOLD_PX) return;
        drag.started = true;
      }
      if (drag.altMode) {
        const distance = Cartesian3.distance(viewer.camera.positionWC, drag.startCart);
        const fovy = (viewer.camera.frustum as PerspectiveFrustum).fovy ?? CesiumMath.toRadians(60);
        const mpp = metersPerPixel(distance, fovy, canvas.clientHeight || 1);
        const alt = altitudeFromDrag(drag.startAlt, e.endPosition.y - drag.start.y, mpp, drag.frame);
        const c = drag.startCarto;
        setEntityPosition(drag.entity, Cartesian3.fromRadians(c.longitude, c.latitude, c.height + (alt - drag.startAlt)));
        drag.last = { ...toDeg(c), alt };
      } else {
        const hit = terrainPick(viewer, e.endPosition);
        if (!hit) return;
        const height = drag.relativeToGround ? drag.startCarto.height : hit.height + drag.startAboveGround;
        setEntityPosition(drag.entity, Cartesian3.fromRadians(hit.longitude, hit.latitude, height));
        drag.last = { ...toDeg(hit), alt: drag.startAlt };
      }
      scene.requestRender();
    };

    const leftUp = () => {
      scene.requestRender();
      const d = drag;
      drag = null;
      setInputs(true);
      if (!d || !d.started) return;
      // A finished drag is never also a click.
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      if (!d.last) { setEntityPosition(d.entity, d.startCart); return; }
      if (d.altMode) {
        if (d.last.alt !== d.startAlt) useMissionStore.getState().updateWaypoint(d.id, { alt: d.last.alt });
        else setEntityPosition(d.entity, d.startCart);
      } else {
        ref.current.handlers.onWaypointDragEnd(d.id, d.last.lat, d.last.lon);
      }
    };

    const leftClick = (e: { position: Cartesian2 }) => {
      scene.requestRender();
      if (suppressClick) return;
      const id = pickWaypointId(viewer, e.position);
      if (id) {
        ref.current.handlers.onWaypointClick(id, mods.ctrl || mods.meta, mods.shift);
        return;
      }
      const hit = groundPick(viewer, e.position);
      if (hit) {
        const { lat, lon } = toDeg(hit);
        ref.current.handlers.onMapClick(lat, lon);
      }
    };

    const rightClick = (e: { position: Cartesian2 }) => {
      scene.requestRender();
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + e.position.x;
      const y = rect.top + e.position.y;
      const id = pickWaypointId(viewer, e.position);
      if (id) {
        ref.current.handlers.onWaypointRightClick(id, x, y);
        return;
      }
      const hit = groundPick(viewer, e.position);
      if (hit) {
        const { lat, lon } = toDeg(hit);
        ref.current.handlers.onMapRightClick(lat, lon, x, y);
      }
    };

    // Cesium dispatches a modified press only to the action registered for that
    // modifier, so every action is registered for each one.
    const handler = new ScreenSpaceEventHandler(canvas);
    for (const mod of MODIFIERS) {
      handler.setInputAction(leftDown, ScreenSpaceEventType.LEFT_DOWN, mod);
      handler.setInputAction(mouseMove, ScreenSpaceEventType.MOUSE_MOVE, mod);
      handler.setInputAction(leftUp, ScreenSpaceEventType.LEFT_UP, mod);
      handler.setInputAction(leftClick, ScreenSpaceEventType.LEFT_CLICK, mod);
      handler.setInputAction(rightClick, ScreenSpaceEventType.RIGHT_CLICK, mod);
    }

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", trackMods, true);
      window.removeEventListener("blur", onBlur);
      canvas.removeEventListener("pointerdown", trackMods, true);
      if (!handler.isDestroyed()) handler.destroy();
      if (!viewer.isDestroyed()) setInputs(true);
    };
  }, [viewer]);
}
