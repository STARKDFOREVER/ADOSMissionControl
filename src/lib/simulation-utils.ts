/**
 * @module simulation-utils
 * @description The flight plan shapes (see `flight-plan` for how they are
 * computed) and position interpolation for mission simulation playback.
 * @license GPL-3.0-only
 */

import type { AltitudeFrame, Waypoint } from "@/lib/types";
import type { RtlTarget } from "@/lib/mission/rtl-target";

/** A resolved point the simulated vehicle flies to. */
export interface SimPoint {
  lat: number;
  lon: number;
  /** Metres above home. */
  alt: number;
}

/**
 * What a segment is:
 * - `climb` / `descent`: vertical, in place (takeoff climb, RTL climb, landing);
 * - `leg`: toward a planner item;
 * - `transit`: to or from the transit altitude;
 * - `return`: the RTL leg to the return point;
 * - `hold`: the final hold or loiter after the last leg.
 */
export type FlightSegmentKind = "climb" | "leg" | "transit" | "descent" | "return" | "hold";

export interface FlightSegment {
  /** Planner index of the item this leg starts at. */
  fromIndex: number;
  /** Planner index of the item this leg flies to. */
  toIndex: number;
  /** Where the leg starts and ends. */
  from: SimPoint;
  to: SimPoint;
  /** Seconds held at `from` before the leg is flown. */
  holdTime: number;
  /** Horizontal length, metres. */
  distance: number;
  /** Horizontal speed, or the vertical rate of a vertical segment, m/s. */
  speed: number;
  /** Seconds, hold included. */
  duration: number;
  cumulativeDuration: number;
  heading: number;
  kind: FlightSegmentKind;
  /** True when the leg is not the straight line drawn between two planner
   * items: the home-to-first-item leg, transit legs and the RTL return leg. */
  implicit: boolean;
  /** Seconds of this segment flown at hover power: holds, loiters and
   * vertical climbs or descents of a multirotor or VTOL. 0 for fixed wing. */
  hoverTime: number;
}

export interface FlightPlan {
  segments: FlightSegment[];
  /** Seconds, holds included. */
  totalDuration: number;
  /** Horizontal metres, including the legs from home and back. */
  totalDistance: number;
  /** True when the plan does not end on its own (unlimited loiter, endless jump,
   * fixed-wing RTL loiter); the duration then covers only the flight up to it. */
  openEnded: boolean;
  /** True when some altitude could not be resolved to height above home (no
   * home or waypoint ground elevation) and its raw value was used. */
  altitudesApproximate: boolean;
  /** Highest point above home along the flight, metres. */
  maxAboveHomeM: number;
  /** Sum of the segments' hover time, seconds. */
  hoverDuration: number;
  /** Where the flight starts and lands, on the ground; null for an empty plan. */
  home: SimPoint | null;
  /** The point RTL returns to, when the plan has an RTL. */
  returnTarget?: RtlTarget;
}

export interface InterpolatedPosition {
  lat: number;
  lon: number;
  alt: number;
  heading: number;
  speed: number;
  currentWaypointIndex: number;
  progress: number;
}

/** Stable identity for the mission inputs that affect simulation playback. */
export function createSimulationMissionSignature(
  waypoints: Waypoint[],
  defaultSpeed: number,
  defaultFrame: AltitudeFrame,
): string {
  return JSON.stringify({
    defaultSpeed,
    defaultFrame,
    waypoints: waypoints.map((wp) => [
      wp.id,
      wp.lat,
      wp.lon,
      wp.alt,
      wp.frame ?? null,
      wp.speed ?? null,
      wp.holdTime ?? null,
      wp.command ?? null,
      wp.param1 ?? null,
      wp.param2 ?? null,
      wp.param3 ?? null,
      wp.groundElevation ?? null,
      wp.actions ?? null,
    ]),
  });
}

/** Interpolate drone position at a given elapsed time. */
export function interpolatePosition(
  segments: FlightSegment[],
  waypoints: Waypoint[],
  elapsedTime: number
): InterpolatedPosition {
  if (waypoints.length === 0) {
    return { lat: 0, lon: 0, alt: 0, heading: 0, speed: 0, currentWaypointIndex: 0, progress: 0 };
  }

  if (segments.length === 0 || elapsedTime <= 0) {
    const start = segments[0]?.from ?? waypoints[0];
    return {
      lat: start.lat,
      lon: start.lon,
      alt: start.alt,
      heading: segments.length > 0 ? segments[0].heading : 0,
      speed: 0,
      currentWaypointIndex: segments[0]?.fromIndex ?? 0,
      progress: 0,
    };
  }

  const last = segments[segments.length - 1];
  const totalDuration = last.cumulativeDuration;

  if (elapsedTime >= totalDuration) {
    return {
      lat: last.to.lat,
      lon: last.to.lon,
      alt: last.to.alt,
      heading: last.heading,
      speed: 0,
      currentWaypointIndex: last.toIndex,
      progress: 1,
    };
  }

  // Find the active segment
  let segIdx = 0;
  for (let i = 0; i < segments.length; i++) {
    if (elapsedTime <= segments[i].cumulativeDuration) {
      segIdx = i;
      break;
    }
  }

  const seg = segments[segIdx];
  const segStart = segIdx > 0 ? segments[segIdx - 1].cumulativeDuration : 0;
  const { from, to, holdTime } = seg;
  const timeInSeg = elapsedTime - segStart;

  // Still holding at the from point
  if (timeInSeg <= holdTime) {
    return {
      lat: from.lat,
      lon: from.lon,
      alt: from.alt,
      heading: seg.heading,
      speed: 0,
      currentWaypointIndex: seg.fromIndex,
      progress: elapsedTime / totalDuration,
    };
  }

  // Traveling between points
  const travelTime = timeInSeg - holdTime;
  const travelDuration = seg.duration - holdTime;
  const t = travelDuration > 0 ? Math.min(travelTime / travelDuration, 1) : 1;

  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lon: from.lon + (to.lon - from.lon) * t,
    alt: from.alt + (to.alt - from.alt) * t,
    heading: seg.heading,
    speed: seg.speed,
    currentWaypointIndex: t > 0.5 ? seg.toIndex : seg.fromIndex,
    progress: elapsedTime / totalDuration,
  };
}

/** Format seconds as M:SS. */
export function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
