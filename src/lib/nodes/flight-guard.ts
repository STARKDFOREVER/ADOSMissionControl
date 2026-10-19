/**
 * @module nodes/flight-guard
 * @description The protocol-level half of the "only a flight node flies"
 * rule. A managed session is wrapped once, when the drone manager adds it;
 * every flight action (arming, mode changes, takeoff/land/RTL, guided and
 * mission commands, uploads, motor and servo output tests, stick override)
 * asks {@link nodeCanFly} for the node's profile at call time and is refused
 * on a node that is not a vehicle. Reads, parameters, calibration and
 * firmware paths pass through untouched, so a Visor's sensor hub stays
 * configurable. UI surfaces hide the same actions through the same rule;
 * this guard is the floor every direct protocol call also meets.
 * @license GPL-3.0-only
 */

import type { CommandResult, DroneProtocol } from "@/lib/protocol/types";
import { nodeCanFly, type NodeProfile } from "./node-profile";

/** Text for a refused flight action on a node that is not a vehicle. */
export const NOT_A_FLIGHT_NODE =
  "This node's flight controller is a sensor hub: flight commands are not offered";

/** Every protocol method that moves, arms or re-tasks the vehicle, or writes
 * a plan it would fly. */
const FLIGHT_METHODS: Record<string, true> = {
  arm: true,
  disarm: true,
  killSwitch: true,
  setFlightMode: true,
  returnToLaunch: true,
  land: true,
  takeoff: true,
  doLandStart: true,
  guidedGoto: true,
  orbit: true,
  setYaw: true,
  changeSpeed: true,
  setHome: true,
  pauseMission: true,
  resumeMission: true,
  setCurrentMissionItem: true,
  clearMission: true,
  uploadMission: true,
  uploadFenceMission: true,
  uploadRallyPoints: true,
  uploadSafehomes: true,
  uploadGeozones: true,
  motorTest: true,
  setMotorTestOutputs: true,
  actuatorTest: true,
  sendDshotCommand: true,
  setServo: true,
};

const REFUSED: CommandResult = { success: false, resultCode: -1, message: NOT_A_FLIGHT_NODE };

/**
 * `protocol` with every flight action refused while `profileOf()` names a
 * node that cannot fly. The profile is read per call, so a profile that
 * arrives after the session attaches still applies.
 */
export function guardFlightActions(
  protocol: DroneProtocol,
  profileOf: () => NodeProfile | undefined,
): DroneProtocol {
  const guarded = new Proxy(protocol, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (prop === "getManualControlBlockedReason") {
        return () => {
          if (!nodeCanFly(profileOf())) return NOT_A_FLIGHT_NODE;
          return typeof value === "function" ? Reflect.apply(value, target, []) : null;
        };
      }
      if (typeof prop !== "string" || typeof value !== "function") return value;
      if (prop === "sendManualControl") {
        return (...a: unknown[]) => {
          if (nodeCanFly(profileOf())) Reflect.apply(value, target, a);
        };
      }
      if (Object.hasOwn(FLIGHT_METHODS, prop)) {
        return (...a: unknown[]) =>
          nodeCanFly(profileOf()) ? Reflect.apply(value, target, a) : Promise.resolve(REFUSED);
      }
      return value.bind(target);
    },
  });
  sources.set(guarded, protocol);
  return guarded;
}

const sources = new WeakMap<DroneProtocol, DroneProtocol>();

/** The protocol a guarded session wraps (itself when it is not guarded). */
export function unguardedProtocol(protocol: DroneProtocol): DroneProtocol {
  return sources.get(protocol) ?? protocol;
}
