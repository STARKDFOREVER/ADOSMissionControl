/**
 * @module patterns/polygon-offset
 * @description Offsetting rings and polylines in local metres, shared by the
 * perimeter, corridor, structure-scan and facade generators.
 * @license GPL-3.0-only
 */

import type { XY } from "./local-geometry";

/** Twice the signed area of a local ring; positive when counter-clockwise. */
export function signedArea2(ring: readonly XY[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return s;
}

/**
 * Offset a simple ring by `d` metres, inward for positive `d` and outward for
 * negative: every edge moves along its normal and consecutive moved edges are
 * intersected (mitred corners). Null when the offset degenerates (the ring
 * turns inside out or an edge reverses).
 */
export function insetRing(ring: readonly XY[], d: number): XY[] | null {
  const n = ring.length;
  const ccw = signedArea2(ring) > 0;
  const edges = ring.map((p, i) => {
    const q = ring[(i + 1) % n];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    // Left normal points inside a counter-clockwise ring.
    const nx = (ccw ? -dy : dy) / len;
    const ny = (ccw ? dx : -dx) / len;
    return { px: p[0] + nx * d, py: p[1] + ny * d, dx, dy };
  });
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const a = edges[(i - 1 + n) % n];
    const b = edges[i];
    const den = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(den) < 1e-9) {
      // Collinear neighbours: the shifted start point is the vertex.
      out.push([b.px, b.py]);
      continue;
    }
    const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den;
    out.push([a.px + a.dx * t, a.py + a.dy * t]);
  }
  if (Math.sign(signedArea2(out)) !== Math.sign(signedArea2(ring))) return null;
  // An offset past a short edge reverses that edge even where the overall
  // orientation survives (a square inset past half its width).
  for (let i = 0; i < n; i++) {
    const a = out[i];
    const b = out[(i + 1) % n];
    if ((b[0] - a[0]) * edges[i].dx + (b[1] - a[1]) * edges[i].dy <= 0) return null;
  }
  return out;
}

/** Convex hull of a point set (monotone chain), counter-clockwise. */
export function convexHull(points: readonly XY[]): XY[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XY[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: XY[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Ratio of a mitred corner's reach to the offset beyond which the corner is bevelled. */
export const MITER_LIMIT = 4;

/**
 * Offset an open polyline sideways by `d` metres (positive = left of the
 * direction of travel). Joins are mitred; a corner whose mitre would reach
 * more than {@link MITER_LIMIT} × |d| from its vertex is bevelled with two points.
 */
export function offsetPolyline(points: readonly XY[], d: number): XY[] {
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-6);
  if (pts.length < 2 || d === 0) return pts.map((p): XY => [p[0], p[1]]);
  const normal = (a: XY, b: XY): XY => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  };
  const out: XY[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0 || i === pts.length - 1) {
      const n = i === 0 ? normal(pts[0], pts[1]) : normal(pts[i - 1], pts[i]);
      out.push([p[0] + n[0] * d, p[1] + n[1] * d]);
      continue;
    }
    const n1 = normal(pts[i - 1], p);
    const n2 = normal(p, pts[i + 1]);
    const bx = n1[0] + n2[0];
    const by = n1[1] + n2[1];
    const blen = Math.hypot(bx, by);
    // cos of half the turn angle; the mitre reaches d / cosHalf from the vertex.
    const cosHalf = blen / 2;
    if (blen < 1e-9 || 1 / cosHalf > MITER_LIMIT) {
      out.push([p[0] + n1[0] * d, p[1] + n1[1] * d], [p[0] + n2[0] * d, p[1] + n2[1] * d]);
    } else {
      const k = d / (cosHalf * blen);
      out.push([p[0] + bx * k, p[1] + by * k]);
    }
  }
  return out;
}
