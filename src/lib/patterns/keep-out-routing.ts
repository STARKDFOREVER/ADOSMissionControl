/**
 * @module patterns/keep-out-routing
 * @description Scan-line clipping and keep-out avoidance for the survey
 * generator, in local metres.
 *
 * Transects are clipped to the boundary on each horizontal scan line and split
 * at the edges of exclusion (keep-out) holes. A transit leg between pieces
 * that would cut through a hole is replaced by a walk along the hole's
 * boundary, the shorter way round.
 *
 * @license GPL-3.0-only
 */

import { distXY, lerpXY, type XY } from "./local-geometry";

/**
 * All x-coordinates where the horizontal line at `y` crosses the polygon's
 * edges, sorted. A half-open rule keeps a vertex on the line from counting twice.
 */
export function horizontalIntersections(polygon: readonly XY[], y: number): number[] {
  const xs: number[] = [];
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
      const t = (y - y1) / (y2 - y1);
      xs.push(x1 + t * (x2 - x1));
    }
  }
  xs.sort((a, b) => a - b);
  return xs;
}

/** A surviving span of a scan line, and whether each end is a hole-edge clip. */
export interface ClippedSpan {
  start: number;
  end: number;
  startClipped: boolean;
  endClipped: boolean;
}

/**
 * Subtract a set of hole intervals from a single [a, b] span on one scan line,
 * returning the surviving sub-spans in ascending order. Each surviving span
 * records whether its start/end is a hole-edge clip (vs. the original boundary).
 */
export function subtractHoleIntervals(a: number, b: number, holes: readonly [number, number][]): ClippedSpan[] {
  if (a >= b) return [];
  const EPS = 1e-6;
  const sorted = holes
    .map(([lo, hi]) => (lo <= hi ? ([lo, hi] as [number, number]) : ([hi, lo] as [number, number])))
    .filter(([lo, hi]) => hi > a && lo < b)
    .sort((p, q) => p[0] - q[0]);

  const out: ClippedSpan[] = [];
  let cursor = a;
  for (const [lo, hi] of sorted) {
    const gapEnd = Math.max(lo, a);
    if (gapEnd - cursor > EPS) {
      out.push({ start: cursor, end: gapEnd, startClipped: cursor !== a, endClipped: true });
    }
    cursor = Math.max(cursor, Math.min(hi, b));
    if (cursor >= b) break;
  }
  if (b - cursor > EPS) {
    out.push({ start: cursor, end: b, startClipped: cursor !== a, endClipped: false });
  }
  return out;
}

const cross2 = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** Even-odd point-in-ring test in local metres. */
function insideRing(p: XY, ring: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Where segment p→q meets the ring's edges, as `t` along the segment, sorted. */
function ringCrossings(p: XY, q: XY, ring: readonly XY[]): { t: number; edge: number }[] {
  const EPS = 1e-9;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const hits: { t: number; edge: number }[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const denom = cross2(dx, dy, ex, ey);
    if (Math.abs(denom) < 1e-12) continue; // parallel: never a crossing
    const apx = a[0] - p[0];
    const apy = a[1] - p[1];
    const t = cross2(apx, apy, ex, ey) / denom;
    const u = cross2(apx, apy, dx, dy) / denom;
    if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) continue;
    hits.push({ t: Math.min(1, Math.max(0, t)), edge: i });
  }
  hits.sort((m, n) => m.t - n.t);
  return hits.filter((h, i) => i === 0 || h.t - hits[i - 1].t > EPS);
}

/** Ring vertices walked from a point on edge `from` to a point on edge `to`, the shorter way. */
function boundaryWalk(ring: readonly XY[], e1: XY, from: number, e2: XY, to: number): XY[] {
  const n = ring.length;
  if (from === to) return [];
  const forward: XY[] = [];
  for (let k = (from + 1) % n; ; k = (k + 1) % n) {
    forward.push(ring[k]);
    if (k === to) break;
  }
  const backward: XY[] = [];
  for (let k = from; ; k = (k - 1 + n) % n) {
    backward.push(ring[k]);
    if (k === (to + 1) % n) break;
  }
  const pathLength = (pts: XY[]) => {
    let len = distXY(e1, pts[0]) + distXY(pts[pts.length - 1], e2);
    for (let i = 1; i < pts.length; i++) len += distXY(pts[i - 1], pts[i]);
    return len;
  };
  return pathLength(forward) <= pathLength(backward) ? forward : backward;
}

/**
 * Intermediate points that take the leg p→q around every keep-out ring it
 * would cross (p and q themselves are not included). Empty when the straight
 * leg is clear.
 */
export function routeAroundHoles(p: XY, q: XY, rings: readonly (readonly XY[])[]): XY[] {
  const out: XY[] = [];
  let from = p;
  for (let guard = 0; guard <= rings.length * 2; guard++) {
    let best: { ring: readonly XY[]; enter: { t: number; edge: number }; exit: { t: number; edge: number } } | null = null;
    for (const ring of rings) {
      const hits = ringCrossings(from, q, ring);
      let first = -1;
      let last = -1;
      for (let i = 0; i + 1 < hits.length; i++) {
        if (insideRing(lerpXY(from, q, (hits[i].t + hits[i + 1].t) / 2), ring)) {
          if (first === -1) first = i;
          last = i + 1;
        }
      }
      if (first === -1) continue;
      if (!best || hits[first].t < best.enter.t) best = { ring, enter: hits[first], exit: hits[last] };
    }
    if (!best) break;
    const e1 = lerpXY(from, q, best.enter.t);
    const e2 = lerpXY(from, q, best.exit.t);
    if (distXY(e1, from) > 1e-6) out.push(e1);
    out.push(...boundaryWalk(best.ring, e1, best.enter.edge, e2, best.exit.edge));
    if (distXY(e2, q) > 1e-6) out.push(e2);
    from = e2;
  }
  return out;
}
