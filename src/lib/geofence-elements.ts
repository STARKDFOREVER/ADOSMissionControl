/**
 * @module geofence-elements
 * @description Pure fence conversions (planner geometry ⇄ FC fence payloads),
 * the fence content hash an upload receipt records, and the fence parameters
 * written alongside the geometry so the flight controller actually enforces
 * what the planner shows (enable, type, altitude ceiling, breach action).
 * @license GPL-3.0-only
 */

import type { DroneProtocol, FenceElement, FenceZoneElement, FirmwareType } from "@/lib/protocol/types";
import type {
  BreachAction,
  FenceType,
  FenceZone,
  GeofenceSnapshot,
} from "@/stores/geofence-store";
import { contentHash } from "@/stores/upload-receipts-store";
import { polygonBounds } from "@/lib/drawing/geo-utils";

/** ArduPilot FENCE_TYPE bitmask */
export const FENCE_TYPE_BITS = {
  ALT_MAX: 1 << 0,
  CIRCLE: 1 << 1,
  POLYGON: 1 << 2,
  /** ArduPilot 4.1+ altitude floor (AC_Fence AC_FENCE_TYPE_ALT_MIN). */
  ALT_MIN: 1 << 3,
} as const;

/**
 * ArduPilot `FENCE_ACTION` values for the breach responses the planner exposes
 * on Copter, Rover and Sub (0 = report only, 1 = RTL or land, 2 = always land).
 */
const AP_FENCE_ACTION: Record<BreachAction, number> = { REPORT: 0, RTL: 1, LAND: 2 };

/**
 * ArduPlane `FENCE_ACTION` values. Plane accepts only 0, 1, 6, 7 and 8 and
 * ignores 2 ("always land") entirely, so a breach would do nothing; the
 * planner's land response maps to 8, AUTOLAND_OR_RTL (fly the DO_LAND_START
 * landing when the mission has one, otherwise RTL).
 */
const AP_PLANE_FENCE_ACTION: Record<BreachAction, number> = { REPORT: 0, RTL: 1, LAND: 8 };

/** PX4 `GF_ACTION` values (0 none, 1 warning, 2 hold, 3 return, 4 terminate, 5 land). */
const PX4_GF_ACTION: Record<BreachAction, number> = { REPORT: 1, RTL: 3, LAND: 5 };

/** The `FENCE_ACTION`/`GF_ACTION` table the firmware reads. */
function actionTable(firmware: FirmwareType | undefined): Record<BreachAction, number> {
  if (firmware === "px4") return PX4_GF_ACTION;
  if (firmware === "ardupilot-plane") return AP_PLANE_FENCE_ACTION;
  return AP_FENCE_ACTION;
}

let zoneIdCounter = 0;
export function nextZoneId(): string {
  return `zone-${++zoneIdCounter}`;
}

/**
 * The inclusion polygon around a set of boundary points: their bounding box
 * expanded outward by `bufferMeters` (a non-positive or non-finite buffer is
 * clamped to zero). `points` must not be empty.
 */
export function boundaryFencePolygon(points: [number, number][], bufferMeters: number): [number, number][] {
  const buffer = Number.isFinite(bufferMeters) && bufferMeters > 0 ? bufferMeters : 0;
  const { minLat, maxLat, minLon, maxLon } = polygonBounds(points);
  // metres -> degrees (~111320 m per degree of latitude; longitude scales
  // with cos(latitude)).
  const dLat = buffer / 111320;
  const meanLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  const dLon = buffer / (111320 * (Math.abs(cosLat) < 1e-6 ? 1e-6 : cosLat));
  return [
    [minLat - dLat, minLon - dLon],
    [minLat - dLat, maxLon + dLon],
    [maxLat + dLat, maxLon + dLon],
    [maxLat + dLat, minLon - dLon],
  ];
}

/**
 * Build the fence model for the mission-type-fence path. The primary fence is
 * an inclusion zone (stay inside); each additional zone keeps its own
 * inclusion/exclusion role. Circles stay native (no polygon approximation).
 * A fence return point, when the fence has one, is carried as its own item.
 */
export function buildFenceElements(
  fenceType: FenceType,
  polygonPoints: [number, number][],
  circleCenter: [number, number] | null,
  circleRadius: number,
  zones: FenceZone[],
  returnPoint?: { lat: number; lon: number } | null,
): FenceElement[] {
  const elements: FenceElement[] = [];
  if (fenceType === "polygon") {
    if (polygonPoints.length >= 3) {
      elements.push({
        kind: "polygon",
        role: "inclusion",
        vertices: polygonPoints.map(([lat, lon]) => ({ lat, lon })),
      });
    }
  } else if (circleCenter) {
    elements.push({
      kind: "circle",
      role: "inclusion",
      center: { lat: circleCenter[0], lon: circleCenter[1] },
      radius: circleRadius,
    });
  }
  for (const z of zones) {
    if (z.type === "polygon") {
      if (z.polygonPoints.length >= 3) {
        elements.push({
          kind: "polygon",
          role: z.role,
          vertices: z.polygonPoints.map(([lat, lon]) => ({ lat, lon })),
        });
      }
    } else if (z.circleCenter) {
      elements.push({
        kind: "circle",
        role: z.role,
        center: { lat: z.circleCenter[0], lon: z.circleCenter[1] },
        radius: z.circleRadius,
      });
    }
  }
  // Geometry decides whether there is a fence to upload; a return point alone
  // is not a fence.
  if (returnPoint && elements.length > 0) {
    elements.push({ kind: "returnPoint", lat: returnPoint.lat, lon: returnPoint.lon });
  }
  return elements;
}

/** Convert a downloaded fence zone element into a store zone. */
export function elementToZone(el: FenceZoneElement): FenceZone {
  if (el.kind === "polygon") {
    return {
      id: nextZoneId(),
      role: el.role,
      type: "polygon",
      polygonPoints: el.vertices.map((v) => [v.lat, v.lon] as [number, number]),
      circleCenter: null,
      circleRadius: 0,
    };
  }
  return {
    id: nextZoneId(),
    role: el.role,
    type: "circle",
    polygonPoints: [],
    circleCenter: [el.center.lat, el.center.lon],
    circleRadius: el.radius,
  };
}

/**
 * Hash of the operator-editable fence content. Zone ids are local handles, not
 * content, so they are left out. The vehicle's home circle is read from the
 * vehicle, never uploaded, so it is not content either.
 */
export function fenceContentHash(s: GeofenceSnapshot): string {
  return contentHash([
    s.enabled,
    s.fenceType,
    s.maxAltitude,
    s.minAltitude,
    s.breachAction,
    s.circleCenter,
    s.circleRadius,
    s.polygonPoints,
    s.zones.map((z) => [z.role, z.type, z.polygonPoints, z.circleCenter, z.circleRadius]),
    // Appended only when present so a fence without one hashes as before.
    ...(s.returnPoint ? [[s.returnPoint.lat, s.returnPoint.lon]] : []),
  ]);
}

/** Outcome of the fence parameter writes; `message` names a failed parameter. */
export interface FenceParamResult {
  success: boolean;
  message: string;
}

async function writeParam(
  protocol: DroneProtocol,
  name: string,
  value: number,
): Promise<string | null> {
  try {
    const r = await protocol.setParameter(name, value);
    return r.success ? null : `${name} write failed: ${r.message}`;
  } catch (err) {
    return `${name} write failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * The circle bit to keep in an ArduPilot FENCE_TYPE write. The home circle
 * (FENCE_RADIUS around home) is not drawn in the planner, so the write keeps
 * whatever the vehicle holds: the live FENCE_TYPE when it can be read, else
 * whether the last download found a home circle.
 */
async function keptCircleBit(protocol: DroneProtocol, homeCircleRadiusM: number | undefined): Promise<number> {
  try {
    const type = (await protocol.getParameter("FENCE_TYPE")).value;
    return type & FENCE_TYPE_BITS.CIRCLE;
  } catch {
    return homeCircleRadiusM !== undefined ? FENCE_TYPE_BITS.CIRCLE : 0;
  }
}

/**
 * Write the fence parameters that make the FC enforce the uploaded geometry.
 * ArduPilot: FENCE_ACTION, FENCE_TYPE (polygon, plus the altitude ceiling and
 * floor bits when each is set, and the vehicle's own home-circle bit), then
 * FENCE_ALT_MAX, FENCE_ALT_MIN, then FENCE_ENABLE last so the fence only turns
 * on once it is configured. PX4: GF_MAX_VER_DIST, then GF_ACTION (0 =
 * disabled); PX4's geofence has no altitude floor, so a non-zero floor is
 * refused rather than silently dropped. Stops at the first failed write.
 */
export async function writeFenceParams(
  protocol: DroneProtocol,
  firmware: FirmwareType | undefined,
  s: Pick<GeofenceSnapshot, "enabled" | "maxAltitude" | "minAltitude" | "breachAction" | "homeCircleRadiusM">,
): Promise<FenceParamResult> {
  const isPx4 = firmware === "px4";
  if (isPx4 && s.minAltitude > 0) {
    return {
      success: false,
      message: "PX4 has no geofence altitude floor; set the fence minimum altitude to 0",
    };
  }
  const action = actionTable(firmware)[s.breachAction];
  const writes: Array<[string, number]> = isPx4
    ? [
        ["GF_MAX_VER_DIST", s.maxAltitude],
        ["GF_ACTION", s.enabled ? action : 0],
      ]
    : [
        ["FENCE_ACTION", action],
        [
          "FENCE_TYPE",
          FENCE_TYPE_BITS.POLYGON |
            (await keptCircleBit(protocol, s.homeCircleRadiusM)) |
            (s.maxAltitude > 0 ? FENCE_TYPE_BITS.ALT_MAX : 0) |
            (s.minAltitude > 0 ? FENCE_TYPE_BITS.ALT_MIN : 0),
        ],
        ...(s.maxAltitude > 0 ? [["FENCE_ALT_MAX", s.maxAltitude] as [string, number]] : []),
        ...(s.minAltitude > 0 ? [["FENCE_ALT_MIN", s.minAltitude] as [string, number]] : []),
        ["FENCE_ENABLE", s.enabled ? 1 : 0],
      ];
  for (const [name, value] of writes) {
    const failure = await writeParam(protocol, name, value);
    if (failure) return { success: false, message: failure };
  }
  return { success: true, message: "Fence parameters written" };
}

/** Fence parameters read back from the FC, in planner terms. */
export interface FenceParams {
  enabled: boolean;
  /** Altitude ceiling above home; 0 when the FC enforces none. */
  maxAltitude: number;
  /** Altitude floor above home; 0 when the FC enforces none. */
  minAltitude: number;
  /** `undefined` when the FC's breach action has no planner equivalent. */
  breachAction: BreachAction | undefined;
  /** Radius (m) of the FC's home-centred circle fence; absent when it enforces none. */
  homeCircleRadiusM?: number;
}

function actionFromValue(table: Record<BreachAction, number>, value: number): BreachAction | undefined {
  return (Object.keys(table) as BreachAction[]).find((k) => table[k] === value);
}

/** Read the fence parameters back. Rejects when any read fails. */
export async function readFenceParams(protocol: DroneProtocol, firmware: FirmwareType | undefined): Promise<FenceParams> {
  if (firmware === "px4") {
    const action = (await protocol.getParameter("GF_ACTION")).value;
    const maxAltitude = (await protocol.getParameter("GF_MAX_VER_DIST")).value;
    return {
      enabled: action !== 0,
      maxAltitude,
      minAltitude: 0,
      breachAction: action === 0 ? undefined : actionFromValue(PX4_GF_ACTION, action),
    };
  }
  const enabled = (await protocol.getParameter("FENCE_ENABLE")).value !== 0;
  const action = (await protocol.getParameter("FENCE_ACTION")).value;
  const type = (await protocol.getParameter("FENCE_TYPE")).value;
  // Each limit is enforced only when its FENCE_TYPE bit is set. FENCE_ALT_MAX
  // keeps its default (100 m on Plane) with the bit clear, so reading it
  // unconditionally would turn a ceiling the vehicle never enforced into one
  // the next upload switches on. Firmware that predates FENCE_ALT_MIN never
  // sets its bit, so it is not read there.
  const maxAltitude =
    (type & FENCE_TYPE_BITS.ALT_MAX) !== 0
      ? (await protocol.getParameter("FENCE_ALT_MAX")).value
      : 0;
  const minAltitude =
    (type & FENCE_TYPE_BITS.ALT_MIN) !== 0
      ? (await protocol.getParameter("FENCE_ALT_MIN")).value
      : 0;
  const homeCircleRadiusM =
    (type & FENCE_TYPE_BITS.CIRCLE) !== 0
      ? (await protocol.getParameter("FENCE_RADIUS")).value
      : undefined;
  return {
    enabled,
    maxAltitude,
    minAltitude,
    breachAction: actionFromValue(actionTable(firmware), action),
    ...(homeCircleRadiusM !== undefined && homeCircleRadiusM > 0 ? { homeCircleRadiusM } : {}),
  };
}
