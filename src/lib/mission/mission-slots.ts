/**
 * Wire slot planning for the mission expander: the order of navigation items,
 * attached actions and the speed items the waypoint speeds require, before
 * sequence numbers are assigned. See `mission-expand` for the speed model.
 *
 * @module mission/mission-slots
 * @license GPL-3.0-only
 */

import type { AltitudeFrame, MissionAction, Waypoint } from "@/lib/types/mission";
import { frameToMav } from "@/lib/mission/altitude-frame";

/**
 * One planned wire slot before sequence numbers are assigned. `owner` is the
 * index of the planner waypoint the slot belongs to; a speed slot's `leg` is
 * the index of the waypoint whose incoming leg it sets.
 */
export type Slot =
  | { kind: "nav"; wp: Waypoint; owner: number }
  | { kind: "action"; act: MissionAction; parentFrame: number; owner: number }
  | { kind: "speed"; speed: number; owner: number; leg: number };

/**
 * Build the ordered slot list: navigation items, their attached actions (an
 * unresolvable DO_JUMP is dropped here so the slot count is final) and the
 * speed items the waypoint speeds require.
 *
 * A DO_JUMP target whose incoming leg has a planned speed gets that speed
 * item directly in front of it, and the jump lands on the speed item, so the
 * repeated leg flies at its planned speed rather than whatever speed the
 * vehicle carried into the jump.
 */
export function planSlots(
  waypoints: readonly Waypoint[],
  defaultFrame: AltitudeFrame,
  defaultSpeed: number | undefined,
): Slot[] {
  const navIds = new Set<string>(waypoints.map((w) => w.id));
  const jumpTargets = new Set<string>();
  for (const wp of waypoints) {
    for (const act of wp.actions ?? []) {
      if (act.command === "DO_JUMP" && act.jumpTargetId !== undefined && navIds.has(act.jumpTargetId)) {
        jumpTargets.add(act.jumpTargetId);
      }
    }
  }
  const slots: Slot[] = [];
  // The speed the vehicle is known to fly at; undefined before the first
  // speed item and after an operator-attached DO_SET_SPEED action.
  let current: number | undefined;
  // True while an attached DO_SET_SPEED action governs the speed: a waypoint
  // with no speed of its own then keeps that speed instead of the default.
  let actionOwnsSpeed = false;
  // Planned speed of each waypoint's incoming leg, when the plan sets one.
  const legSpeed = new Map<number, number>();

  const pushSpeedFor = (index: number, owner: number) => {
    const wp = waypoints[index];
    const want = wp.speed ?? (actionOwnsSpeed ? undefined : defaultSpeed);
    if (want === undefined || !(want > 0)) return;
    legSpeed.set(index, want);
    if (want === current) return;
    slots.push({ kind: "speed", speed: want, owner, leg: index });
    current = want;
    actionOwnsSpeed = false;
  };

  waypoints.forEach((wp, i) => {
    const parentFrame = frameToMav(wp.frame ?? defaultFrame);
    if (i === 0) pushSpeedFor(0, 0);
    const speed = legSpeed.get(i);
    const prev = slots.at(-1);
    if (jumpTargets.has(wp.id) && speed !== undefined && !(prev?.kind === "speed" && prev.leg === i)) {
      // Same speed the normal path already flies here; a jump needs it again.
      slots.push({ kind: "speed", speed, owner: Math.max(i - 1, 0), leg: i });
    }
    slots.push({ kind: "nav", wp, owner: i });

    const actions = wp.actions ?? [];
    if (actions.some((a) => a.command === "DO_SET_SPEED")) {
      current = undefined;
      actionOwnsSpeed = true;
    } else if (i + 1 < waypoints.length) {
      // Right after the nav item, ahead of its actions, so a CONDITION_* gate
      // or a DO_JUMP among them cannot delay or skip the leg's speed.
      pushSpeedFor(i + 1, i);
    }

    for (const act of actions) {
      if (act.command === "DO_JUMP") {
        const target = act.jumpTargetId;
        if (target === undefined || !navIds.has(target)) continue; // drop + re-tighten
      }
      slots.push({ kind: "action", act, parentFrame, owner: i });
    }
  });
  return slots;
}
