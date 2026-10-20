/**
 * @module fc-item-count
 * @description How many mission items a plan uploads, against the storage the
 * flight controller has for them.
 *
 * MAVLink autopilots store the expanded wire list: every navigation item, every
 * attached action and every speed item the uploader writes for leg speeds, and
 * ArduPilot keeps the home position in slot 0 on top of that. ArduPilot's
 * capacity depends on the board's storage size, so the advisory names the
 * storage classes rather than one number:
 *  - 8 KB storage (or 15 KB flash storage): about 300 items;
 *  - 16 KB storage: about 650 items;
 *  - 32 KB storage: about 1,300 items.
 * MSP firmware (iNav, Betaflight) stores one entry per waypoint and action.
 *
 * Pure logic: no React / store / Leaflet imports, fully unit-testable.
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import type { FirmwareType } from "@/lib/protocol/types/enums";
import { expandedItemOwners } from "@/lib/mission/mission-expand";

/** Firmware families that share a common item-count ceiling. */
export type FcFamily = "ardupilot" | "px4" | "betaflight" | "inav";

/** ArduPilot mission capacity (home included) by board storage size, smallest first. */
export const ARDUPILOT_STORAGE_CLASSES: ReadonlyArray<{ storageKb: number; items: number }> = [
  { storageKb: 8, items: 300 },
  { storageKb: 16, items: 650 },
  { storageKb: 32, items: 1300 },
];

/** Above this many items a plan no longer fits the smallest ArduPilot boards. */
export const ARDUPILOT_SMALL_BOARD_ITEMS = ARDUPILOT_STORAGE_CLASSES[0].items;

/**
 * Per-firmware item-count ceilings.
 *  - ArduPilot: the largest common storage class (32 KB boards).
 *  - PX4: the dataman mission store is sized by the build option
 *    NUM_MISSION_ITEMS_SUPPORTED, default 500.
 *  - iNav: NAV_MAX_WAYPOINTS, 120 on the common targets.
 *  - Betaflight: no mission storage; kept small so a plan reads as unfit.
 */
export const FC_ITEM_COUNT_LIMITS: Record<FcFamily, number> = {
  ardupilot: ARDUPILOT_STORAGE_CLASSES[ARDUPILOT_STORAGE_CLASSES.length - 1].items,
  px4: 500,
  betaflight: 60,
  inav: 120,
};

/** Fallback ceiling when no firmware or explicit limit is supplied. */
export const DEFAULT_FC_ITEM_LIMIT = FC_ITEM_COUNT_LIMITS.ardupilot;

/**
 * Fraction of an explicit or non-ArduPilot ceiling at or above which the
 * advisory escalates to `warn`. ArduPilot warns once a plan outgrows the
 * smallest storage class instead.
 */
export const ITEM_COUNT_WARN_RATIO = 0.9;

/** Options for {@link checkItemCount}. */
export interface ItemCountOptions {
  /**
   * Explicit item ceiling. When a positive number is supplied it overrides the
   * firmware-derived default.
   */
  limit?: number;
  /**
   * Connected firmware whose default ceiling applies when `limit` is absent.
   * Unknown firmware is counted and limited as ArduPilot.
   */
  firmware?: FirmwareType;
  /** Mission default speed: the uploader writes a speed item for it. */
  defaultSpeed?: number;
}

/** Advisory result. `level` is always `info` or `warn`; never an error. */
export interface ItemCountAdvisory {
  /** Number of mission items the plan uploads, including any home slot. */
  count: number;
  /** Ceiling the count was compared against. */
  limit: number;
  /** `warn` once the count approaches or exceeds the ceiling, else `info`. */
  level: "info" | "warn";
}

/**
 * Map a full {@link FirmwareType} to its {@link FcFamily}, or `null` when the
 * firmware is unknown / unmapped.
 */
export function fcFamilyFromFirmware(firmware: FirmwareType): FcFamily | null {
  if (firmware.startsWith("ardupilot")) return "ardupilot";
  if (firmware === "px4") return "px4";
  if (firmware === "betaflight") return "betaflight";
  if (firmware === "inav") return "inav";
  return null;
}

/** Resolve the default item ceiling for a firmware type. */
export function limitForFirmware(firmware: FirmwareType): number {
  const family = fcFamilyFromFirmware(firmware);
  return family ? FC_ITEM_COUNT_LIMITS[family] : DEFAULT_FC_ITEM_LIMIT;
}

/**
 * Number of mission items a plan occupies on a flight controller of `family`.
 *
 * - ArduPilot: the expanded wire items plus the home slot at index 0.
 * - PX4: the expanded wire items.
 * - iNav / Betaflight: one entry per waypoint and per attached action.
 */
export function missionItemCount(
  waypoints: readonly Waypoint[] | null | undefined,
  family: FcFamily,
  defaultSpeed?: number,
): number {
  if (!Array.isArray(waypoints) || waypoints.length === 0) return 0;
  if (family === "inav" || family === "betaflight") {
    return waypoints.reduce((total, wp) => total + 1 + (wp.actions?.length ?? 0), 0);
  }
  const items = expandedItemOwners(waypoints, { defaultSpeed }).length;
  return family === "ardupilot" ? items + 1 : items;
}

/**
 * Advise on the mission item count relative to a firmware's storage ceiling.
 *
 * `level` is `warn` once the plan outgrows the smallest ArduPilot storage
 * class (ArduPilot with no explicit limit), or once it reaches
 * {@link ITEM_COUNT_WARN_RATIO} of the ceiling otherwise. Blocking an upload
 * that cannot fit is the validator's job; this only describes the count.
 */
export function checkItemCount(
  waypoints: readonly Waypoint[] | null | undefined,
  options: ItemCountOptions = {},
): ItemCountAdvisory {
  const family: FcFamily = (options.firmware && fcFamilyFromFirmware(options.firmware)) || "ardupilot";
  const count = missionItemCount(waypoints, family, options.defaultSpeed);
  const explicit =
    typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0;
  if (explicit) {
    const limit = options.limit as number;
    return { count, limit, level: count >= limit * ITEM_COUNT_WARN_RATIO ? "warn" : "info" };
  }
  const limit = FC_ITEM_COUNT_LIMITS[family];
  const warn =
    family === "ardupilot" ? count > ARDUPILOT_SMALL_BOARD_ITEMS : count >= limit * ITEM_COUNT_WARN_RATIO;
  return { count, limit, level: warn ? "warn" : "info" };
}
