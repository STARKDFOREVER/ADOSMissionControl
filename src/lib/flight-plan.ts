/**
 * @module flight-plan
 * @description The flight estimate behind the simulation, the dock statistics,
 * the energy estimate and the flight brief. It follows how the autopilot flies
 * the plan, not the lines drawn on the map:
 * - The vehicle starts on the ground at the planned home. A multirotor or VTOL
 *   TAKEOFF climbs straight up there, whatever the item's own position; a plane
 *   climbs out toward the next item.
 * - Distance is horizontal. A leg takes the longest of its horizontal time at
 *   the leg speed and its climb or descent at the vertical rates. Altitudes are
 *   resolved to height above home through each waypoint's frame.
 * - LAND flies across at the current altitude and then descends, the last
 *   metres at the landing speed. RTL climbs to the return altitude (capped by
 *   an altitude fence), flies to the closest rally point or home, loiters and
 *   lands; a fixed-wing RTL loiters there indefinitely.
 * - An attached DO_SET_SPEED holds until a later waypoint sets its own speed.
 * - Fixed wing ignores waypoint hold times; LOITER_TURNS circles its turns.
 * - Nothing after LAND or RTL counts; an unlimited LOITER or an endless jump
 *   ends the estimate open-ended. DO_JUMP loops are unrolled.
 * - A transit altitude adds its climb-over legs (see `mission/transit`).
 * @license GPL-3.0-only
 */

import type { AltitudeFrame, PlanAutopilot, PlanVehicleClass, Waypoint } from "@/lib/types";
import type { FlightPlan, FlightSegment, FlightSegmentKind, SimPoint } from "@/lib/simulation-utils";
import { bearing } from "@/lib/telemetry-utils";
import { haversineDistance } from "@/lib/geo/distance";
import { planLaunchPoint } from "@/lib/mission/plan-home";
import { inferHomeGroundElevation, resolveWaypointAltitude } from "@/lib/mission/altitude-frame";
import { effectiveWaypoints } from "@/lib/validation/autopilot-rules";
import { applyTransit } from "@/lib/mission/transit";
import { flightSequence } from "@/lib/mission/flight-sequence";
import { rtlCruiseAltitude, rtlTarget, type LatLon, type RtlTarget } from "@/lib/mission/rtl-target";

/** Altitude RTL climbs to before returning: the ArduPilot RTL_ALT default (15 m). */
export const SIM_RTL_ALT_M = 15;

/** Vertical rates per vehicle class when the vehicle does not report its own, m/s. */
export const DEFAULT_VERTICAL_RATES: Record<PlanVehicleClass, { climb: number; descent: number }> = {
  copter: { climb: 2.5, descent: 1.5 },
  vtol: { climb: 2.5, descent: 1.5 },
  plane: { climb: 5, descent: 3 },
  rover: { climb: 2.5, descent: 1.5 },
};

/** ArduCopter `LAND_SPEED` default, m/s, and `LAND_ALT_LOW` default, m. */
const DEFAULT_LAND_SPEED_MPS = 0.5;
const DEFAULT_LAND_SLOW_ALT_M = 10;
/** ArduCopter `RTL_LOIT_TIME` default, s. */
const ARDUCOPTER_RTL_LOITER_S = 5;
/** LOITER_TURNS radius when the item leaves it 0: Copter `CIRCLE_RADIUS`, Plane `WP_LOITER_RAD`. */
const DEFAULT_TURN_RADIUS_M: Record<"hover" | "fixed", number> = { hover: 10, fixed: 60 };

export interface FlightPlanOptions {
  /** The plan's planned home: where the vehicle launches and RTL returns to.
   * Defaults to the plan's launch point at an unknown ground elevation. */
  home?: { lat: number; lon: number; groundAmsl?: number };
  /** Altitude RTL climbs to before returning, metres above home: the vehicle's
   * configured return altitude when known, else {@link SIM_RTL_ALT_M}. */
  rtlAltM?: number;
  /** Autopilot flying the plan; default ArduPilot. */
  autopilot?: PlanAutopilot;
  /** Vehicle class flying the plan; default multirotor. */
  vehicleClass?: PlanVehicleClass;
  /** Mission default altitude frame; default relative. */
  defaultFrame?: AltitudeFrame;
  /** Transit altitude above home (see `mission/transit`); absent or null = off. */
  transitAltM?: number | null;
  /** Vertical rates, m/s; default per vehicle class ({@link DEFAULT_VERTICAL_RATES}). */
  climbRateMps?: number;
  descentRateMps?: number;
  /** Final landing descent rate and the height it starts at. */
  landSpeedMps?: number;
  landSlowAltM?: number;
  /** Seconds a multirotor RTL loiters over the return point (ArduCopter 5 s, PX4 0 s). */
  rtlLoiterS?: number;
  /** Rally points an RTL may return to. */
  rally?: readonly LatLon[];
  rallyLimitKm?: number;
  rallyIncludeHome?: boolean;
  px4RtlType?: number;
  /** Ceiling the return altitude is capped at (fence maximum minus margin), metres above home. */
  returnCeilingM?: number;
}

/** A plan with no flight. */
function emptyPlan(): FlightPlan {
  return {
    segments: [], totalDuration: 0, totalDistance: 0, openEnded: false,
    altitudesApproximate: false, maxAboveHomeM: 0, hoverDuration: 0, home: null,
  };
}

/**
 * Where each item of the transit-expanded plan sits in the planner's own list:
 * a generated transit waypoint maps to the work waypoint it climbs over.
 */
function plannerIndexes(expanded: readonly Waypoint[], original: readonly Waypoint[]): number[] {
  const byId = new Map<string, number>();
  original.forEach((w, i) => byId.set(w.id, i));
  const out = expanded.map((w) => byId.get(w.id) ?? -1);
  for (let j = 0; j < out.length; j++) {
    if (out[j] >= 0) continue;
    // "-transit-out" precedes the first work waypoint; "-transit-back" follows the last.
    out[j] = expanded[j].id.endsWith("-transit-out") ? (out[j + 1] ?? 0) : (out[j - 1] ?? 0);
  }
  return out;
}

/**
 * Compute the flight plan of `waypoints` (the planner list). Segments refer to
 * planner indices; generated transit legs refer to the work waypoint they
 * climb over.
 */
export function computeFlightPlan(
  waypoints: Waypoint[],
  defaultSpeed: number,
  options: FlightPlanOptions = {},
): FlightPlan {
  const autopilot = options.autopilot ?? "ardupilot";
  const vehicleClass = options.vehicleClass ?? "copter";
  const fixedWing = vehicleClass === "plane" || vehicleClass === "vtol";
  const canHover = vehicleClass !== "plane" && vehicleClass !== "rover";
  const ground = vehicleClass === "rover";
  const rates = DEFAULT_VERTICAL_RATES[vehicleClass];
  const climbRate = options.climbRateMps && options.climbRateMps > 0 ? options.climbRateMps : rates.climb;
  const descentRate = options.descentRateMps && options.descentRateMps > 0 ? options.descentRateMps : rates.descent;
  const landSpeed = options.landSpeedMps && options.landSpeedMps > 0 ? options.landSpeedMps : DEFAULT_LAND_SPEED_MPS;
  const landSlowAlt = options.landSlowAltM ?? DEFAULT_LAND_SLOW_ALT_M;
  const rtlLoiter = options.rtlLoiterS ?? (autopilot === "ardupilot" ? ARDUCOPTER_RTL_LOITER_S : 0);
  const rtlAlt = options.rtlAltM ?? SIM_RTL_ALT_M;

  const homeLatLon = options.home ?? planLaunchPoint(waypoints);
  if (!homeLatLon) return emptyPlan();
  const homeGround = options.home?.groundAmsl ?? inferHomeGroundElevation(waypoints);
  const datums = { homeGroundElevation: homeGround, defaultFrame: options.defaultFrame };

  const expanded = effectiveWaypoints(
    applyTransit(waypoints, options.transitAltM ?? null, datums),
    { autopilot, vehicleClass },
  );
  const toPlanner = plannerIndexes(expanded, waypoints);
  // ArduPilot QuadPlane flies RTL as a plane; a PX4 VTOL lands vertically.
  const sequence = flightSequence(expanded, {
    fixedWing: vehicleClass === "plane" || (vehicleClass === "vtol" && autopilot === "ardupilot"),
  });
  if (sequence.order.length === 0) return emptyPlan();

  let approximate = false;
  const heightOf = (wp: Waypoint): number => {
    if (ground) return 0;
    const above = resolveWaypointAltitude(wp, datums).aboveHome;
    if (above !== null) return above;
    approximate = true;
    return Number.isFinite(wp.alt) ? wp.alt : 0;
  };

  const home: SimPoint = { lat: homeLatLon.lat, lon: homeLatLon.lon, alt: 0 };
  const segments: FlightSegment[] = [];
  let cumDuration = 0;
  let totalDistance = 0;
  let pos: SimPoint = home;
  let posIndex = toPlanner[sequence.order[0]];
  let pendingHold = 0;
  let pendingHoldHover = false;
  let returnTarget: RtlTarget | undefined;
  // True once the vehicle has flown its first horizontal leg away from home;
  // that first leg is not a line between two planner items.
  let leftHome = false;

  const push = (
    to: SimPoint,
    toIndex: number,
    kind: FlightSegmentKind,
    implicit: boolean,
    horizontalSpeed: number,
  ) => {
    const distance = haversineDistance(pos.lat, pos.lon, to.lat, to.lon);
    const dz = to.alt - pos.alt;
    const horizontalTime = horizontalSpeed > 0 ? distance / horizontalSpeed : 0;
    const verticalTime = dz > 0 ? dz / climbRate : -dz / descentRate;
    const travel = Math.max(horizontalTime, verticalTime);
    const vertical = distance < 0.5;
    if (travel <= 0 && pendingHold <= 0 && distance === 0) {
      posIndex = toIndex;
      return;
    }
    const hold = pendingHold;
    const hoverTime = canHover ? (pendingHoldHover ? hold : 0) + (vertical ? travel : 0) : 0;
    const duration = hold + travel;
    cumDuration += duration;
    totalDistance += distance;
    segments.push({
      fromIndex: posIndex,
      toIndex,
      from: pos,
      to,
      holdTime: hold,
      distance,
      speed: vertical ? (dz > 0 ? climbRate : descentRate) : horizontalSpeed,
      duration,
      cumulativeDuration: cumDuration,
      heading: vertical
        ? (segments[segments.length - 1]?.heading ?? 0)
        : bearing(pos.lat, pos.lon, to.lat, to.lon),
      kind,
      implicit: implicit || (!vertical && !leftHome),
      hoverTime,
    });
    if (!vertical) leftHome = true;
    pos = to;
    posIndex = toIndex;
    pendingHold = 0;
    pendingHoldHover = false;
  };
  /** Descend to `groundAlt` in place: the descent rate, the last metres at the landing speed. */
  const land = (toIndex: number, groundAlt: number, loiterS: number) => {
    pendingHold += loiterS;
    pendingHoldHover = true;
    const height = pos.alt - groundAlt;
    if (height <= 0 && pendingHold <= 0) return;
    const fast = Math.max(0, height - landSlowAlt);
    const slow = Math.max(0, height - fast);
    const travel = fast / descentRate + slow / landSpeed;
    const to: SimPoint = { lat: pos.lat, lon: pos.lon, alt: groundAlt };
    const hold = pendingHold;
    cumDuration += hold + travel;
    segments.push({
      fromIndex: posIndex, toIndex, from: pos, to, holdTime: hold, distance: 0,
      speed: height > 0 && travel > 0 ? height / travel : 0, duration: hold + travel,
      cumulativeDuration: cumDuration, heading: segments[segments.length - 1]?.heading ?? 0,
      kind: "descent", implicit: false, hoverTime: canHover ? hold + travel : 0,
    });
    pos = to;
    posIndex = toIndex;
    pendingHold = 0;
    pendingHoldHover = false;
  };

  // Speed model of the upload: a waypoint's own speed governs the leg into
  // it; an attached DO_SET_SPEED holds until a later waypoint sets its own.
  let speed = defaultSpeed;
  let actionOwnsSpeed = false;

  for (const k of sequence.order) {
    const wp = expanded[k];
    const cmd = wp.command ?? "WAYPOINT";
    const index = toPlanner[k];
    if (wp.speed !== undefined && wp.speed > 0) {
      speed = wp.speed;
      actionOwnsSpeed = false;
    } else if (!actionOwnsSpeed) {
      speed = defaultSpeed;
    }
    const positioned = !wp.inheritsPosition && !(wp.lat === 0 && wp.lon === 0);
    const target: SimPoint = {
      lat: positioned ? wp.lat : pos.lat,
      lon: positioned ? wp.lon : pos.lon,
      alt: heightOf(wp),
    };
    const transit = wp.id.endsWith("-transit-out") || wp.id.endsWith("-transit-back");

    if (cmd === "TAKEOFF" || cmd === "VTOL_TAKEOFF") {
      const vertical = !(vehicleClass === "plane" || (vehicleClass === "vtol" && cmd === "TAKEOFF"));
      if (vertical && !ground && target.alt > pos.alt) {
        push({ lat: pos.lat, lon: pos.lon, alt: target.alt }, index, "climb", false, 0);
      }
      posIndex = index;
      // A copter's TAKEOFF position is ignored: it climbs where it stands.
    } else if (cmd === "RTL") {
      returnTarget = rtlTarget(pos, home, options.rally ?? [], {
        autopilot, vehicleClass,
        rallyLimitKm: options.rallyLimitKm,
        rallyIncludeHome: options.rallyIncludeHome,
        px4RtlType: options.px4RtlType,
      });
      const cruise = ground ? 0 : rtlCruiseAltitude(pos.alt, rtlAlt, options.returnCeilingM);
      if (cruise > pos.alt) push({ lat: pos.lat, lon: pos.lon, alt: cruise }, index, "climb", false, 0);
      push({ lat: returnTarget.lat, lon: returnTarget.lon, alt: cruise }, index, "return", true, defaultSpeed);
      if (sequence.loiterIndex === k) break; // fixed wing: loiters over the return point
      if (!ground) land(index, 0, canHover ? rtlLoiter : 0);
    } else if (cmd === "LAND" || cmd === "VTOL_LAND") {
      const groundAlt = wp.groundElevation !== undefined && Number.isFinite(wp.groundElevation) && homeGround !== undefined
        ? wp.groundElevation - homeGround
        : 0;
      if (fixedWing && cmd === "LAND") {
        // A plane descends along the approach to the touchdown point.
        push({ lat: target.lat, lon: target.lon, alt: groundAlt }, index, "leg", false, speed);
      } else {
        push({ lat: target.lat, lon: target.lon, alt: pos.alt }, index, "leg", false, speed);
        if (!ground) land(index, groundAlt, 0);
      }
    } else {
      push(target, index, transit ? "transit" : "leg", transit, speed);
      if (cmd === "LOITER_TURNS") {
        const turns = Math.max(0, wp.holdTime ?? 0);
        const radius = Math.abs(wp.param2 ?? 0) || DEFAULT_TURN_RADIUS_M[canHover ? "hover" : "fixed"];
        pendingHold += speed > 0 ? (turns * 2 * Math.PI * radius) / speed : 0;
        pendingHoldHover = false;
      } else if (cmd === "LOITER_TIME") {
        pendingHold += wp.holdTime ?? 0;
        pendingHoldHover = canHover;
      } else if ((cmd === "WAYPOINT" || cmd === "SPLINE_WAYPOINT") && !fixedWing) {
        pendingHold += wp.holdTime ?? 0;
        pendingHoldHover = canHover;
      }
    }

    for (const act of wp.actions ?? []) {
      if (act.command === "DO_SET_SPEED" && (act.param2 ?? 0) > 0) {
        speed = act.param2 as number;
        actionOwnsSpeed = true;
      }
    }
  }

  if (pendingHold > 0) {
    const hold = pendingHold;
    cumDuration += hold;
    segments.push({
      fromIndex: posIndex, toIndex: posIndex, from: pos, to: pos, holdTime: hold, distance: 0, speed: 0,
      duration: hold, cumulativeDuration: cumDuration, heading: segments[segments.length - 1]?.heading ?? 0,
      kind: "hold", implicit: false, hoverTime: canHover && pendingHoldHover ? hold : 0,
    });
  }

  let maxAboveHomeM = 0;
  let hoverDuration = 0;
  for (const seg of segments) {
    maxAboveHomeM = Math.max(maxAboveHomeM, seg.from.alt, seg.to.alt);
    hoverDuration += seg.hoverTime;
  }
  return {
    segments,
    totalDuration: cumDuration,
    totalDistance,
    openEnded: sequence.openEnded,
    altitudesApproximate: approximate,
    maxAboveHomeM,
    hoverDuration,
    home,
    returnTarget,
  };
}
