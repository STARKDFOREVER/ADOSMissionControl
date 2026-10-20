/**
 * Pure mission ⇄ wire mapping: expand a waypoint list (with per-waypoint
 * attached actions) into a flat, contiguously-sequenced `MissionItem[]` and
 * collapse it back. This is the single source of truth for how the GCS's
 * waypoint model maps onto the MAVLink mission wire format.
 *
 * FLIGHT-SAFETY-CRITICAL: a wrong `seq` uploaded to real hardware is a crash.
 * Every expanded item satisfies `items[i].seq === i` (asserted at runtime).
 *
 * Sequence math: a navigation command owns one item at `seq = k`; its attached
 * actions follow at `seq = k+1 … k+m`; the next navigation command starts at
 * `seq = k+m+1`. `DO_JUMP` targets are carried in the model as a waypoint `id`
 * and resolved to the flattened target `seq` here (a two-pass process), so the
 * jump survives editing that shifts sequence numbers.
 *
 * ArduPilot keeps the home position in mission slot 0 and starts execution at
 * slot 1. With `reserveHomeSlot` the expander writes that home item at seq 0
 * and every mission item (and every DO_JUMP target) starts at seq 1. PX4 and
 * iNav missions start at seq 0. The first mission item (after any home slot)
 * carries `current = 1`: PX4 starts the mission there.
 *
 * NAV byte-mapping is the one-slot shift (holdTime → param1, param1 → param2,
 * param2 → param3, param3 → param4); the per-command editors write the model
 * slot that lands in the right MAVLink slot (LOITER_TURNS turns and
 * PAYLOAD_PLACE max descent live in `holdTime`, the loiter radius in `param2`).
 * Per-item frames and parameter slots are in `mission-item-encode`.
 *
 * Speed: a waypoint's `speed` is the speed of the leg flown INTO it (absent =
 * the mission default speed): ground speed for a multirotor or rover, airspeed
 * for a plane or VTOL, where a ground-speed change sets ArduPlane's minimum
 * ground speed instead of its cruise speed. The flight controller only changes
 * speed on a DO_CHANGE_SPEED item, which takes effect when the vehicle leaves
 * the navigation item it follows, so the expander writes one before the first
 * navigation item and one right after navigation item i-1 whenever the leg
 * into waypoint i needs a different speed. `collapseFromItems` folds those
 * items back into `speed`. An operator-attached DO_SET_SPEED action governs
 * the legs after its waypoint until a later waypoint sets its own speed.
 *
 * @module mission/mission-expand
 * @license GPL-3.0-only
 */

import type { MissionItem } from "@/lib/protocol/types/mission";
import type {
  ActionCommand,
  AltitudeFrame,
  CommandMissionAction,
  PlanAutopilot,
  PlanVehicleClass,
  RawMissionAction,
  Waypoint,
  WaypointCommand,
} from "@/lib/types/mission";
import {
  cmdMap, reverseCmd, MAV_CMD_DO_SET_ROI, MAV_CMD_NAV_DELAY, MAV_ROI_LOCATION,
} from "./command-map";
import { mavToFrame } from "@/lib/mission/altitude-frame";
import { isNavCommand, LOCATION_MAV_CMDS, POSITION_BEARING_ACTIONS } from "./command-classes";
import { actionItem, homeItem, MAV_FRAME_MISSION, navItem } from "./mission-item-encode";
import { planSlots } from "./mission-slots";


/** A home position written into ArduPilot's reserved mission slot 0. */
export interface HomeSlot {
  lat: number;
  lon: number;
  /** Home altitude, metres AMSL (the slot is written in MAV_FRAME_GLOBAL). */
  alt: number;
}

/** Options for {@link expandToItems}. */
export interface ExpandOptions {
  /** Autopilot the items are encoded for; frames and command ids differ per autopilot. */
  autopilot: PlanAutopilot;
  /** Vehicle class the items are encoded for; speed type and accepted commands differ per class. */
  vehicleClass: PlanVehicleClass;
  /** Mission default altitude frame, applied to any waypoint with no explicit frame. */
  defaultFrame: AltitudeFrame;
  /**
   * Write this home position at seq 0 and start the mission at seq 1 (the
   * ArduPilot mission layout). Every DO_JUMP target shifts with the items.
   */
  reserveHomeSlot?: HomeSlot;
  /**
   * Mission default speed (m/s) for a waypoint with no `speed`. Absent: only
   * waypoints with an explicit `speed` produce speed items.
   */
  defaultSpeed?: number;
}

/** DO_CHANGE_SPEED speed type: airspeed. */
const SPEED_TYPE_AIRSPEED = 0;
/** DO_CHANGE_SPEED speed type: ground speed. */
const SPEED_TYPE_GROUND = 1;
/** DO_CHANGE_SPEED throttle value meaning "leave the throttle unchanged". */
const THROTTLE_NO_CHANGE = -1;

/**
 * The planner waypoint index that owns each item {@link expandToItems}
 * produces, in item order, excluding any home slot.
 */
export function expandedItemOwners(
  waypoints: readonly Waypoint[],
  opts: Pick<ExpandOptions, "defaultSpeed"> = {},
): number[] {
  // Ownership does not depend on the frame; any frame yields the same slots.
  return planSlots(waypoints, "relative", opts.defaultSpeed).map((slot) => slot.owner);
}

/**
 * Expand a waypoint list into a flat, contiguously-sequenced `MissionItem[]`.
 *
 * - With `reserveHomeSlot`, seq 0 is the home item and the mission starts at 1.
 * - Each navigation waypoint becomes one item using the one-slot-shift mapping.
 * - Each attached action becomes its own item sequenced right after its parent,
 *   using correct MAVLink parameter slots; a raw passthrough action re-emits
 *   the item it was collapsed from.
 * - A DO_CHANGE_SPEED item precedes the first leg and follows any navigation
 *   item whose outgoing leg changes speed (see the module note on speed).
 * - `DO_JUMP` actions resolve their `jumpTargetId` to the target's flattened
 *   `seq`; an unresolved / missing target drops that `DO_JUMP` item and the
 *   remaining items re-tighten so `seq` stays contiguous.
 *
 * @throws never — malformed jumps are dropped, not thrown.
 */
export function expandToItems(
  waypoints: readonly Waypoint[],
  opts: ExpandOptions,
): MissionItem[] {
  const slots = planSlots(waypoints, opts.defaultFrame, opts.defaultSpeed);
  // A plane or VTOL flies its legs at an airspeed; a ground-speed change on
  // ArduPlane sets the minimum ground speed, not the cruise speed.
  const speedType = opts.vehicleClass === "plane" || opts.vehicleClass === "vtol"
    ? SPEED_TYPE_AIRSPEED
    : SPEED_TYPE_GROUND;

  // The first mission seq: 1 when slot 0 holds the home position.
  const base = opts.reserveHomeSlot ? 1 : 0;

  // Assign seq = base + index and record each waypoint's jump-landing seq: the
  // speed item directly in front of it for its own leg, else the nav item.
  const seqById = new Map<string, number>();
  slots.forEach((slot, i) => {
    if (slot.kind !== "nav") return;
    const prev = slots[i - 1];
    const landsOnSpeed = prev?.kind === "speed" && prev.leg === slot.owner;
    seqById.set(slot.wp.id, base + (landsOnSpeed ? i - 1 : i));
  });

  // Pass 2: emit items. The first mission item is the current one.
  const items: MissionItem[] = opts.reserveHomeSlot ? [homeItem(opts.reserveHomeSlot)] : [];
  slots.forEach((slot, i) => {
    const seq = base + i;
    switch (slot.kind) {
      case "nav":
        items.push(navItem(slot.wp, seq, i === 0, opts.defaultFrame));
        break;
      case "action":
        items.push({
          ...actionItem(slot.act, seq, slot.parentFrame, seqById, opts.autopilot),
          current: i === 0 ? 1 : 0,
        });
        break;
      case "speed":
        items.push({ ...speedItem(slot.speed, seq, speedType), current: i === 0 ? 1 : 0 });
        break;
    }
  });

  // FLIGHT-SAFETY invariant: contiguous sequence from 0 (home slot included).
  for (let i = 0; i < items.length; i++) {
    if (items[i].seq !== i) {
      throw new Error(
        `mission expand produced a non-contiguous sequence: item ${i} has seq ${items[i].seq}`,
      );
    }
  }

  return items;
}

/**
 * A DO_CHANGE_SPEED item setting `speed` (m/s) as `speedType` (airspeed for a
 * plane or VTOL, ground speed otherwise), throttle unchanged. It carries no
 * position, so it is written in `MAV_FRAME_MISSION`.
 */
export function speedItem(speed: number, seq: number, speedType: number = SPEED_TYPE_GROUND): MissionItem {
  return {
    seq,
    frame: MAV_FRAME_MISSION,
    command: cmdMap.DO_SET_SPEED,
    current: 0,
    autocontinue: 1,
    param1: speedType,
    param2: speed,
    param3: THROTTLE_NO_CHANGE,
    param4: 0,
    x: 0,
    y: 0,
    z: 0,
  };
}

/**
 * True for the DO_CHANGE_SPEED shape {@link speedItem} writes (or another
 * ground station writes the same way): an airspeed or ground-speed change
 * with the throttle unchanged and no other parameter set, in any frame.
 */
export function isFoldableSpeedItem(item: MissionItem): boolean {
  return item.command === cmdMap.DO_SET_SPEED
    && (item.param1 === SPEED_TYPE_GROUND || item.param1 === SPEED_TYPE_AIRSPEED)
    && item.param2 > 0
    && item.param3 === THROTTLE_NO_CHANGE
    && (item.param4 === 0 || Number.isNaN(item.param4))
    && item.x === 0 && item.y === 0 && item.z === 0;
}

/**
 * Nav commands whose 0,0 location means "the vehicle's position when it gets
 * here" (ArduPilot and PX4 read a zero location that way). RTL ignores its
 * location entirely, and ArduPilot stores and returns it as 0,0; an RTL that
 * does carry coordinates (a file this planner wrote) keeps them so the file
 * round-trips byte for byte.
 */
const ZERO_MEANS_HERE: ReadonlySet<WaypointCommand> = new Set([
  "RTL", "TAKEOFF", "LAND", "LOITER", "LOITER_TIME", "LOITER_TURNS", "VTOL_TAKEOFF", "VTOL_LAND",
]);

function inheritsPosition(command: WaypointCommand, item: MissionItem): boolean {
  return ZERO_MEANS_HERE.has(command) && item.x === 0 && item.y === 0;
}

/** A wire parameter as a model slot: 0 and non-finite (NaN = "unset") are absent. */
function slotValue(v: number): number | undefined {
  return Number.isFinite(v) && v !== 0 ? v : undefined;
}

/**
 * The planner command a wire item collapses to, or `undefined` for an
 * unmodelled one. DO_SET_ROI (201) is the planner's ROI only in its
 * point-at-a-location mode; NAV_DELAY is the DELAY action on PX4.
 */
function modelCommand(item: MissionItem, autopilot: PlanAutopilot | undefined): WaypointCommand | undefined {
  if (item.command === MAV_CMD_DO_SET_ROI) return item.param1 === MAV_ROI_LOCATION ? "ROI" : undefined;
  if (item.command === MAV_CMD_NAV_DELAY) return autopilot === "px4" ? "DELAY" : undefined;
  return reverseCmd[item.command];
}

/**
 * Collapse a flat `MissionItem[]` back into waypoints with attached actions.
 *
 * Each navigation item starts a fresh `Waypoint`; each action item folds into
 * the current waypoint's `actions[]`. A `DO_JUMP` item's raw `param1` (target
 * seq) resolves to the `id` of the first navigation waypoint at or after that
 * seq: a jump aimed at a leg's speed item or at an attached action continues
 * into the next waypoint, which is where the vehicle flies after it. Targets
 * resolve by absolute seq, so a list that starts at seq 1 (ArduPilot, home
 * slot removed) needs no rebasing. A jump with no waypoint at or after its
 * target is removed and reported through `onDropped`, never silently lost.
 *
 * A command this GCS does not model is never turned into a navigation
 * waypoint: it rides the current waypoint as a `RAW` passthrough action and
 * re-expands byte-for-byte. Any item before the first navigation item (a known
 * action or an unmodelled command) has no waypoint to ride; it is dropped and
 * reported through `onDropped` so the caller can warn the operator.
 *
 * Each navigation waypoint's altitude FRAME is restored from the item's
 * `MAV_FRAME`; an item in `MAV_FRAME_MISSION` (RTL, DO_LAND_START) has none of
 * its own and takes the previous waypoint's. So does an RTL in any frame:
 * ArduPilot stores none for it and reports it in `MAV_FRAME_GLOBAL` at 0 m,
 * which read literally is a return to sea level. `0` and non-finite parameter
 * slots collapse to `undefined` (the model treats absent and zero as the same
 * value, and NaN is "unset"); `expandToItems` re-emits `0`, or NaN for an
 * unset heading. `autocontinue = 0` is kept as `autocontinue: false`.
 *
 * A DO_CHANGE_SPEED item of the shape the expander writes, placed before a
 * later navigation item, becomes that waypoint's `speed`, and the speed
 * carries to each following waypoint until the next change, which is how the
 * vehicle flies it. Any other DO_SET_SPEED stays an attached action, and the
 * waypoints after it carry no speed of their own.
 *
 * `home` is the stand-in position for a leading item that flies "from here".
 * `autopilot` names where the items came from: PX4 missions carry the
 * planner's DELAY as NAV_DELAY; from any other source NAV_DELAY stays an
 * unmodelled passthrough.
 */
export function collapseFromItems(
  items: readonly MissionItem[],
  onDropped?: (item: MissionItem) => void,
  home?: { lat: number; lon: number },
  autopilot?: PlanAutopilot,
): Waypoint[] {
  const waypoints: Waypoint[] = [];
  /** NAV items in wire order, for jump-target resolution. */
  const navSeqToId: Array<{ seq: number; id: string }> = [];
  /** DO_JUMP actions awaiting a second-pass target-id resolution. */
  const pendingJumps: Array<{ act: CommandMissionAction; owner: Waypoint; item: MissionItem }> = [];

  let current: Waypoint | undefined;
  // Seq-order index of the last navigation item: a speed item after it has no
  // leg to fold into and is kept as an action in place.
  let lastNavIndex = -1;
  items.forEach((item, i) => {
    const cmd = modelCommand(item, autopilot);
    if (cmd !== undefined && isNavCommand(cmd)) lastNavIndex = i;
  });
  /** Speed set by a folded speed item since the previous navigation item. */
  let pendingSpeed: number | undefined;
  /** Speed the vehicle carries into the next leg, when the model knows it. */
  let carriedSpeed: number | undefined;

  for (const [index, item] of items.entries()) {
    const command = modelCommand(item, autopilot);
    const stops = item.autocontinue === 0 ? { autocontinue: false as const } : {};

    if (index < lastNavIndex && isFoldableSpeedItem(item)) {
      pendingSpeed = item.param2;
      continue;
    }

    if (command !== undefined && isNavCommand(command)) {
      const speed = pendingSpeed ?? carriedSpeed;
      pendingSpeed = undefined;
      carriedSpeed = speed;
      const inherits = inheritsPosition(command, item);
      // A stand-in position for an item the vehicle flies "from here".
      const standIn = inherits ? (current ?? home) : undefined;
      const frame = item.frame === MAV_FRAME_MISSION || command === "RTL"
        ? current?.frame
        : mavToFrame(item.frame);
      const wp: Waypoint = {
        id: freshId(),
        lat: standIn ? standIn.lat : item.x / 1e7,
        lon: standIn ? standIn.lon : item.y / 1e7,
        ...(inherits ? { inheritsPosition: true } : {}),
        alt: item.z,
        speed,
        command,
        ...(frame !== undefined ? { frame } : {}),
        holdTime: slotValue(item.param1),
        param1: slotValue(item.param2),
        param2: slotValue(item.param3),
        param3: slotValue(item.param4),
        ...stops,
        actions: [],
      };
      waypoints.push(wp);
      navSeqToId.push({ seq: item.seq, id: wp.id });
      current = wp;
      continue;
    }

    if (!current) {
      onDropped?.(item); // nothing to attach a leading non-nav item to
      continue;
    }

    current.actions = current.actions ?? [];

    if (command === undefined) {
      const raw: RawMissionAction = {
        id: freshId(),
        command: "RAW",
        rawCommand: item.command,
        param1: item.param1,
        param2: item.param2,
        param3: item.param3,
        param4: item.param4,
        x: item.x,
        y: item.y,
        z: item.z,
        frame: item.frame,
        ...stops,
      };
      current.actions.push(raw);
      continue;
    }

    const actionCommand = command as ActionCommand;
    const positional = POSITION_BEARING_ACTIONS.has(actionCommand);
    const isJump = actionCommand === "DO_JUMP";
    // DO_SET_ROI's param1 is the ROI mode (always "location" here), not the
    // DO_SET_ROI_LOCATION gimbal id the ROI action re-expands as.
    const legacyRoi = item.command === MAV_CMD_DO_SET_ROI;
    if (actionCommand === "DO_SET_SPEED") {
      // This action sets the speed from here on in a way the model does not
      // carry, so the following waypoints keep no speed of their own.
      pendingSpeed = undefined;
      carriedSpeed = undefined;
    }
    const action: CommandMissionAction = {
      id: freshId(),
      command: actionCommand,
      // DO_JUMP's param1 is the target seq (→ jumpTargetId), not a user param.
      param1: isJump || legacyRoi ? undefined : slotValue(item.param1),
      // NAV_DELAY's param2..4 are an absolute time, unused by the DELAY action.
      param2: item.command === MAV_CMD_NAV_DELAY ? undefined : slotValue(item.param2),
      param3: item.command === MAV_CMD_NAV_DELAY ? undefined : slotValue(item.param3),
      param4: item.command === MAV_CMD_NAV_DELAY ? undefined : slotValue(item.param4),
      param5: positional ? undefined : slotValue(item.x),
      param6: positional ? undefined : slotValue(item.y),
      param7: positional ? undefined : slotValue(item.z),
      lat: positional ? item.x / 1e7 : undefined,
      lon: positional ? item.y / 1e7 : undefined,
      alt: positional ? item.z : undefined,
      ...stops,
    };
    current.actions.push(action);
    if (isJump) pendingJumps.push({ act: action, owner: current, item });
  }

  // A leading position-inheriting item with no previous waypoint and no home
  // takes the next real position (a TAKEOFF climbs where the mission starts).
  const firstPositioned = waypoints.find((w) => !w.inheritsPosition);
  for (const wp of waypoints) {
    if (!wp.inheritsPosition || wp.lat !== 0 || wp.lon !== 0 || !firstPositioned) continue;
    wp.lat = firstPositioned.lat;
    wp.lon = firstPositioned.lon;
  }

  // Second pass: resolve DO_JUMP target seq → the NAV waypoint it lands on.
  for (const { act, owner, item } of pendingJumps) {
    const target = landingNavId(navSeqToId, item.param1);
    if (target !== undefined) {
      act.jumpTargetId = target;
      continue;
    }
    owner.actions = (owner.actions ?? []).filter((a) => a !== act);
    onDropped?.(item);
  }

  return waypoints;
}

/** A short operator-facing name for a MAV_CMD id ("DO_JUMP", or "MAV_CMD 181"). */
export function missionCommandName(command: number): string {
  const known: WaypointCommand | undefined = reverseCmd[command];
  return known ?? `MAV_CMD ${command}`;
}

/**
 * True when an item's x/y carry a latitude/longitude (degrees × 1e7 on the
 * wire, plain degrees in a text file). A modelled non-positional action carries
 * MAVLink param5/param6 there instead, unscaled. An unmodelled command is
 * scaled only when MAVLink defines its param5/param6 as a location.
 */
export function itemCarriesLocation(command: number): boolean {
  const known: WaypointCommand | undefined = reverseCmd[command];
  if (known === undefined) return LOCATION_MAV_CMDS.has(command);
  if (isNavCommand(known)) return true;
  return POSITION_BEARING_ACTIONS.has(known as ActionCommand);
}

/** Find the id of the NAV waypoint with the least seq ≥ `targetSeq`. */
function landingNavId(
  navSeqToId: ReadonlyArray<{ seq: number; id: string }>,
  targetSeq: number,
): string | undefined {
  let best: { seq: number; id: string } | undefined;
  for (const nav of navSeqToId) {
    if (nav.seq >= targetSeq && (best === undefined || nav.seq < best.seq)) best = nav;
  }
  return best?.id;
}

/** Generate a fresh short waypoint / action id (matches existing download ids). */
function freshId(): string {
  return Math.random().toString(36).substring(2, 10);
}
