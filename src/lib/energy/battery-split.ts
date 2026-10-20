/**
 * Battery split: where a plan has to stop for a fresh pack. A pack flies the
 * plan until the next waypoint would leave too little charge to fly home with
 * the reserve intact; the next pack resumes from the waypoint after that (see
 * `mission/resume`).
 *
 * @module energy/battery-split
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types/mission";
import type { FlightPlan } from "@/lib/simulation-utils";
import { haversineDistance } from "@/lib/geo/distance";

/** A battery pack the operator flies with. */
export interface BatteryProfile {
  id: string;
  name: string;
  /** Usable energy of a full pack, watt-hours. */
  capacityWh: number;
  /** Average power in forward flight, watts. */
  cruisePowerW: number;
  /** Average power while hovering, climbing or holding, watts. */
  hoverPowerW: number;
  /** Charge kept in reserve at landing, percent of capacity. */
  reservePct: number;
}

/** One pack's share of a plan. */
export interface BatterySplit {
  /** Planner index of the first waypoint this pack flies to. */
  fromIndex: number;
  /** Planner index of the last waypoint this pack reaches. */
  toIndex: number;
  /** Energy the pack spends, watt-hours, including its flight home. */
  energyWh: number;
  /** Flight time on this pack, seconds, including its flight home. */
  durationS: number;
}

/** The plan state on arrival at a waypoint. */
interface Arrival {
  index: number;
  energyWh: number;
  durationS: number;
  lat: number;
  lon: number;
  speed: number;
}

/** Energy of one segment: hover-class time at hover power, the rest at cruise power. */
function segmentEnergyWh(seg: FlightPlan["segments"][number], pack: BatteryProfile): number {
  const cruise = Math.max(0, seg.duration - seg.hoverTime);
  return (seg.hoverTime * pack.hoverPowerW + cruise * pack.cruisePowerW) / 3600;
}

/**
 * Split `plan` across packs of `pack`. A pack ends at the last waypoint where
 * the energy used so far plus the energy to fly home from there (horizontal,
 * at cruise power and the leg speed) stays within
 * `capacityWh × (1 − reservePct / 100)`; the next pack starts at the following
 * waypoint, flying out from home to the waypoint the previous pack stopped at.
 * Every pack reaches at least one new waypoint, so a leg no pack can fly still
 * gets its own pack. Returns `[]` for an empty plan.
 */
export function splitByBattery(
  plan: FlightPlan,
  waypoints: Waypoint[],
  pack: BatteryProfile,
  homeLatLon: { lat: number; lon: number },
): BatterySplit[] {
  if (plan.segments.length === 0 || waypoints.length === 0) return [];

  // Arrival at each waypoint, in flight order (a repeated jump body arrives
  // more than once). A leg made of several segments arrives at its last one.
  const firstSeg = plan.segments[0];
  const arrivals: Arrival[] = [
    { index: firstSeg.fromIndex, energyWh: 0, durationS: 0, lat: firstSeg.from.lat, lon: firstSeg.from.lon, speed: firstSeg.speed },
  ];
  let energy = 0;
  let duration = 0;
  plan.segments.forEach((seg, i) => {
    energy += segmentEnergyWh(seg, pack);
    duration += seg.duration;
    const next = plan.segments[i + 1];
    if (next && next.toIndex === seg.toIndex && next.fromIndex === seg.fromIndex) return;
    arrivals.push({ index: seg.toIndex, energyWh: energy, durationS: duration, lat: seg.to.lat, lon: seg.to.lon, speed: seg.speed });
  });
  // The final hold after the last leg is flown in place, at hover power.
  const trailingHoldS = Math.max(0, plan.totalDuration - duration);
  const endEnergy = energy + (trailingHoldS * pack.hoverPowerW) / 3600;
  const endDuration = plan.totalDuration;

  const usable = pack.capacityWh * (1 - pack.reservePct / 100);
  const legHome = (a: Arrival) => {
    const speed = a.speed > 0 ? a.speed : 1;
    const seconds = haversineDistance(a.lat, a.lon, homeLatLon.lat, homeLatLon.lon) / speed;
    return { energyWh: (seconds * pack.cruisePowerW) / 3600, durationS: seconds };
  };

  const packs: BatterySplit[] = [];
  // Arrival index the pack starts at: 0 is the takeoff point, any later one
  // is the waypoint after the previous pack's last, reached from home via
  // that last waypoint.
  let start = 0;
  for (;;) {
    const firstReach = start === 0 ? 1 : start;
    if (firstReach >= arrivals.length) break;
    const out = start === 0 ? { energyWh: 0, durationS: 0 } : legHome(arrivals[start - 1]);
    const base = start === 0 ? arrivals[0] : arrivals[start - 1];
    const usedTo = (k: number) => out.energyWh + arrivals[k].energyWh - base.energyWh;

    let end = firstReach - 1;
    for (let k = firstReach; k < arrivals.length; k++) {
      if (usedTo(k) + legHome(arrivals[k]).energyWh > usable) break;
      end = k;
    }
    // Always make progress: a pack reaches at least its first waypoint.
    if (end < firstReach) end = firstReach;

    const last = end === arrivals.length - 1;
    const home = last
      ? { energyWh: endEnergy - arrivals[end].energyWh, durationS: endDuration - arrivals[end].durationS }
      : legHome(arrivals[end]);
    packs.push({
      fromIndex: arrivals[start].index,
      toIndex: arrivals[end].index,
      energyWh: usedTo(end) + home.energyWh,
      durationS: out.durationS + arrivals[end].durationS - base.durationS + home.durationS,
    });
    if (last) break;
    start = end + 1;
  }
  return packs;
}
