/**
 * @module patterns/capture-line
 * @description The one emitter the camera patterns (survey, corridor,
 * structure scan, facade) use to fly a capture line.
 *
 * A line is a polyline in local metres. Moving capture flies a run-in
 * overshoot, arms the distance trigger at the first point, flies the line,
 * disarms at the last point and flies the run-out. Both trigger rows ask for
 * one photo immediately (param3 = 1), as ArduPilot and PX4 only shoot at the
 * arming point when asked, so a line of length L at trigger distance d takes
 * `floor(L / d) + 2` photos. Hover-and-capture instead stops at every capture
 * point for one second and takes a single photo there; no overshoot and no
 * distance trigger are emitted.
 *
 * @license GPL-3.0-only
 */

import type { PatternWaypoint } from "./types";
import { distXY, pointsAlong, polylineLength, type XY } from "./local-geometry";

export interface CaptureLineOptions {
  /** Row altitude, metres. */
  altitude: number;
  /** Cruise speed, m/s. */
  speed: number;
  /** Camera trigger distance, metres; 0 = no camera on this line. */
  triggerDistance: number;
  /** Overshoot before the first point, metres. */
  turnStart: number;
  /** Overshoot after the last point, metres. */
  turnEnd: number;
  /** Stop and shoot at every capture point instead of shooting on distance. */
  hoverAndCapture?: boolean;
  /** Called before each navigation row of the line (e.g. to aim an ROI at it). */
  beforeNav?: (p: XY, altitude: number) => void;
  /** Called right after the line's first navigation row, before the trigger arms. */
  afterFirstNav?: (p: XY, altitude: number) => void;
  /** Extra points flown from the previous line's end to this line's entry (e.g. around a keep-out). */
  transit?: (from: XY, to: XY) => XY[];
}

const HOVER_HOLD_S = 1;

export class CaptureLineEmitter {
  readonly rows: PatternWaypoint[] = [];
  photoCount = 0;
  /** Last navigation point emitted (or the start point passed in), local metres. */
  last: XY | null;

  constructor(private readonly toGeo: (p: XY) => [number, number], start: XY | null = null) {
    this.last = start;
  }

  /** Append a navigation row. */
  nav(p: XY, altitude: number, speed: number, holdTime?: number): void {
    const [lat, lon] = this.toGeo(p);
    const row: PatternWaypoint = { lat, lon, alt: altitude, speed, command: "WAYPOINT" };
    if (holdTime !== undefined) row.holdTime = holdTime;
    this.rows.push(row);
    this.last = p;
  }

  /** Append an action row at a local point (it rides the navigation row before it). */
  action(p: XY, altitude: number, speed: number, fields: Omit<PatternWaypoint, "lat" | "lon" | "alt" | "speed">): void {
    const [lat, lon] = this.toGeo(p);
    this.rows.push({ lat, lon, alt: altitude, speed, ...fields });
  }

  /** Fly one capture line along `points` (two or more, local metres). */
  line(points: readonly XY[], opts: CaptureLineOptions): void {
    const { altitude, speed, triggerDistance } = opts;
    const first = points[0];
    const lastPt = points[points.length - 1];
    const navAt = (p: XY, holdTime?: number) => {
      opts.beforeNav?.(p, altitude);
      this.nav(p, altitude, speed, holdTime);
    };
    const enterAt = (entry: XY) => {
      if (this.last && opts.transit) for (const p of opts.transit(this.last, entry)) this.nav(p, altitude, speed);
    };

    if (opts.hoverAndCapture && triggerDistance > 0) {
      const captures = pointsAlong(points, triggerDistance);
      enterAt(captures[0]);
      captures.forEach((p, i) => {
        navAt(p, HOVER_HOLD_S);
        if (i === 0) opts.afterFirstNav?.(p, altitude);
        this.action(p, altitude, speed, { command: "DO_DIGICAM", param5: 1 });
      });
      this.photoCount += captures.length;
      return;
    }

    const runIn = overshoot(first, points[1], opts.turnStart);
    const runOut = overshoot(lastPt, points[points.length - 2], opts.turnEnd);
    const camera = triggerDistance > 0;
    const inner = points.slice(1, -1);
    enterAt(runIn);

    navAt(runIn);
    if (camera && opts.turnStart > 0) navAt(first);
    opts.afterFirstNav?.(first, altitude);
    if (camera) this.action(first, altitude, speed, { command: "DO_SET_CAM_TRIGG", param1: triggerDistance, param3: 1 });
    for (const p of inner) navAt(p);
    if (camera) {
      navAt(lastPt);
      this.action(lastPt, altitude, speed, { command: "DO_SET_CAM_TRIGG", param1: 0, param3: 1 });
      if (opts.turnEnd > 0) navAt(runOut);
      this.photoCount += Math.floor(polylineLength(points) / triggerDistance) + 2;
    } else {
      navAt(opts.turnEnd > 0 ? runOut : lastPt);
    }
  }
}

/** `p` pushed `by` metres further along the direction from `from` to `p` (a turn-around overshoot). */
function overshoot(p: XY, from: XY, by: number): XY {
  const d = distXY(from, p);
  if (by <= 0 || d === 0) return p;
  const k = by / d;
  return [p[0] + (p[0] - from[0]) * k, p[1] + (p[1] - from[1]) * k];
}
