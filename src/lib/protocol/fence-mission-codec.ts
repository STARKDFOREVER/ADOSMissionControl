/**
 * Fence-type mission codec: the fence model to and from the seq-indexed
 * MISSION_ITEM_INT items a fence mission (mission_type = fence) carries.
 *
 * @module protocol/fence-mission-codec
 */

import type { FenceElement } from './types'

/** MAV_FRAME_GLOBAL. Altitude is Reserved for fence polygon/circle vertices. */
const MAV_FRAME_GLOBAL = 0

/** NAV_FENCE_* mission-item commands (used when mission_type = fence). */
export const MAV_CMD_NAV_FENCE_RETURN_POINT = 5000
export const MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION = 5001
export const MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION = 5002
export const MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION = 5003
export const MAV_CMD_NAV_FENCE_CIRCLE_EXCLUSION = 5004

/** A single fence mission item, flattened and ready for MISSION_ITEM_INT. */
export interface FenceMissionItem {
  seq: number
  frame: number
  command: number
  param1: number
  param2: number
  /** Latitude * 1e7. */
  x: number
  /** Longitude * 1e7. */
  y: number
  z: number
}

/**
 * Flatten the fence model into a seq-indexed list of MISSION_ITEM_INT items for
 * a fence-type mission upload. A polygon emits one item per vertex, each
 * carrying param1 = the polygon's total vertex count (min 3); a circle emits one
 * item with param1 = radius (m). Elements with fewer than 3 polygon vertices are
 * skipped. Lat/lon are scaled to int32 * 1e7; altitude is Reserved (z = 0).
 */
export function encodeFenceMissionItems(elements: FenceElement[]): FenceMissionItem[] {
  const items: FenceMissionItem[] = []
  let seq = 0
  for (const el of elements) {
    if (el.kind === 'polygon') {
      const n = el.vertices.length
      if (n < 3) continue
      const command = el.role === 'inclusion'
        ? MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION
        : MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION
      const group = el.role === 'inclusion' ? (el.group ?? 0) : 0
      for (const v of el.vertices) {
        items.push({
          seq: seq++, frame: MAV_FRAME_GLOBAL, command,
          param1: n, param2: group,
          x: Math.round(v.lat * 1e7), y: Math.round(v.lon * 1e7), z: 0,
        })
      }
    } else {
      const command = el.role === 'inclusion'
        ? MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION
        : MAV_CMD_NAV_FENCE_CIRCLE_EXCLUSION
      const group = el.role === 'inclusion' ? (el.group ?? 0) : 0
      items.push({
        seq: seq++, frame: MAV_FRAME_GLOBAL, command,
        param1: el.radius, param2: group,
        x: Math.round(el.center.lat * 1e7), y: Math.round(el.center.lon * 1e7), z: 0,
      })
    }
  }
  return items
}

/**
 * Reassemble downloaded fence mission items into the fence model. Consecutive
 * polygon-vertex items of the same command are grouped into one polygon using
 * param1 (vertex count); each circle item is a standalone element; a return
 * point (5000) is ignored. Items are sorted by seq first.
 */
export function decodeFenceMissionItems(items: FenceMissionItem[]): FenceElement[] {
  const sorted = [...items].sort((a, b) => a.seq - b.seq)
  const elements: FenceElement[] = []
  let poly: { role: 'inclusion' | 'exclusion'; command: number; group: number; remaining: number; vertices: Array<{ lat: number; lon: number }> } | null = null

  const flushPoly = () => {
    if (poly && poly.vertices.length >= 3) {
      elements.push({ kind: 'polygon', role: poly.role, vertices: poly.vertices, group: poly.group })
    }
    poly = null
  }

  for (const it of sorted) {
    if (
      it.command === MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION ||
      it.command === MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION
    ) {
      const role = it.command === MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION ? 'inclusion' : 'exclusion'
      const count = Math.max(3, Math.round(it.param1))
      if (!poly || poly.command !== it.command || poly.remaining <= 0) {
        flushPoly()
        poly = { role, command: it.command, group: Math.round(it.param2), remaining: count, vertices: [] }
      }
      poly.vertices.push({ lat: it.x / 1e7, lon: it.y / 1e7 })
      poly.remaining -= 1
      if (poly.remaining <= 0) flushPoly()
    } else if (
      it.command === MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION ||
      it.command === MAV_CMD_NAV_FENCE_CIRCLE_EXCLUSION
    ) {
      flushPoly()
      const role = it.command === MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION ? 'inclusion' : 'exclusion'
      elements.push({
        kind: 'circle', role,
        center: { lat: it.x / 1e7, lon: it.y / 1e7 },
        radius: it.param1, group: Math.round(it.param2),
      })
    }
    // MAV_CMD_NAV_FENCE_RETURN_POINT (5000) carries no geometry we model, ignore.
  }
  flushPoly()
  return elements
}

