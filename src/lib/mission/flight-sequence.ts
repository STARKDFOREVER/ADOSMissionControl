/**
 * The order the autopilot flies a plan's items in: DO_JUMP loops unrolled the
 * number of times they repeat, and nothing counted past the item the mission
 * ends at (LAND, RTL, an unlimited LOITER). Used by the flight estimate.
 *
 * ArduPilot and PX4 run a jump with repeat N so its loop body flies N + 1
 * times; repeat −1 loops forever and any other negative repeat is never taken.
 * A fixed-wing RTL in a plan with a DO_LAND_START continues into the landing
 * sequence that follows it instead of loitering over home.
 *
 * @module mission/flight-sequence
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types/mission";
import { isFlownCommand } from "@/lib/mission/command-classes";

/** Flown legs counted at most; a longer unrolled plan is reported open-ended. */
export const MAX_SEQUENCE_LEGS = 1000;

/** Hard stop on visited items, so a jump loop with no flown item ends. */
const MAX_VISITS = 100_000;

export interface FlightSequence {
  /** Planner indices of the flown items, in flight order (repeats included). */
  order: number[];
  /** True when the plan never ends on its own (an unlimited loiter, an endless
   * jump, a fixed-wing RTL loiter) or is longer than {@link MAX_SEQUENCE_LEGS}. */
  openEnded: boolean;
  /** Planner index of the item the plan ends with an open-ended loiter at, when it does. */
  loiterIndex?: number;
}

export interface FlightSequenceOptions {
  /** True for a fixed-wing vehicle, whose RTL loiters at the return point. */
  fixedWing: boolean;
}

/** Unroll `waypoints` into the order they are flown. */
export function flightSequence(waypoints: readonly Waypoint[], opts: FlightSequenceOptions): FlightSequence {
  const indexById = new Map<string, number>();
  waypoints.forEach((w, i) => indexById.set(w.id, i));
  const landStart = waypoints.findIndex((w) => w.command === "DO_LAND_START");
  const remaining = new Map<string, number>();
  const order: number[] = [];
  let usedLandStart = false;
  let visits = 0;

  let i = 0;
  while (i < waypoints.length) {
    if (++visits > MAX_VISITS || order.length > MAX_SEQUENCE_LEGS) return { order, openEnded: true };
    const wp = waypoints[i];
    const cmd = wp.command ?? "WAYPOINT";

    if (isFlownCommand(cmd)) {
      if (cmd === "RTL" && opts.fixedWing) {
        if (landStart >= 0 && !usedLandStart) {
          // RTL with a landing sequence: fly it from the DO_LAND_START on.
          usedLandStart = true;
          i = landStart + 1;
          continue;
        }
        order.push(i);
        return { order, openEnded: true, loiterIndex: i };
      }
      order.push(i);
      if (cmd === "RTL" || cmd === "LAND" || cmd === "VTOL_LAND") return { order, openEnded: false };
      if (cmd === "LOITER") return { order, openEnded: true, loiterIndex: i };
    }

    let next = i + 1;
    for (const act of wp.actions ?? []) {
      if (act.command !== "DO_JUMP" || act.jumpTargetId === undefined) continue;
      const target = indexById.get(act.jumpTargetId);
      if (target === undefined) continue;
      const repeat = act.param2 ?? 0;
      if (repeat === -1) {
        // Loops forever: the body has been counted once.
        return { order, openEnded: true };
      }
      const left = remaining.get(act.id) ?? repeat;
      if (left > 0) {
        remaining.set(act.id, left - 1);
        next = target;
        break;
      }
    }
    i = next;
  }
  return { order, openEnded: false };
}
