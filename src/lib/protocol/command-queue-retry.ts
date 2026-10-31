/**
 * Retry and resend policy for the COMMAND_LONG / COMMAND_INT queue: silent
 * resends of idempotent commands, TEMPORARILY_REJECTED retries, and the
 * COMMAND_INT fallback for builds that only accept COMMAND_INT.
 *
 * @module protocol/command-queue-retry
 */

import type { CommandResult } from "./types";
import { encodeCommandInt, encodeCommandLong } from "./encoders";

const MAV_FRAME_GLOBAL = 0;
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;
/** MAV_RESULT_TEMPORARILY_REJECTED. */
const RESULT_TEMPORARILY_REJECTED = 1;

/**
 * Commands whose COMMAND_LONG param5/param6 carry latitude/longitude in
 * degrees, with the frame the autopilot assumes for them. Converting such a
 * command to COMMAND_INT scales x/y by 1e7; every other command carries
 * param5/param6 into x/y unscaled. This mirrors the conversion ArduPilot
 * applies to an incoming COMMAND_LONG.
 */
const LONG_LOCATION_COMMAND_FRAME: Readonly<Record<number, number>> = {
  179: MAV_FRAME_GLOBAL, // DO_SET_HOME
  195: MAV_FRAME_GLOBAL_RELATIVE_ALT, // DO_SET_ROI_LOCATION
  201: MAV_FRAME_GLOBAL_RELATIVE_ALT, // DO_SET_ROI
  192: MAV_FRAME_GLOBAL_RELATIVE_ALT, // DO_REPOSITION
  611: MAV_FRAME_GLOBAL, // DO_SET_GLOBAL_ORIGIN
  43003: MAV_FRAME_GLOBAL, // EXTERNAL_POSITION_ESTIMATE
};

/**
 * Commands whose repeat leaves the vehicle in the same state, so they are sent
 * again when no COMMAND_ACK arrives, as the MAVLink command protocol expects of
 * the sender (confirmation incremented on each COMMAND_LONG resend). A command
 * that acts again when repeated (camera trigger or capture, calibration, motor
 * or actuator test, relative yaw) or that the vehicle refuses when already done
 * (takeoff while airborne) is sent once.
 */
const RESEND_SAFE_COMMANDS: ReadonlySet<number> = new Set([
  400, // COMPONENT_ARM_DISARM
  176, // DO_SET_MODE
  20, // NAV_RETURN_TO_LAUNCH
  21, // NAV_LAND
  185, // DO_FLIGHTTERMINATION
  192, // DO_REPOSITION
  193, // DO_PAUSE_CONTINUE
  178, // DO_CHANGE_SPEED
  179, // DO_SET_HOME
  207, // DO_FENCE_ENABLE
  181, // DO_SET_RELAY
  183, // DO_SET_SERVO
  204, // DO_MOUNT_CONFIGURE
  205, // DO_MOUNT_CONTROL
  195, // DO_SET_ROI_LOCATION
  197, // DO_SET_ROI_NONE
  34, // DO_ORBIT
  511, // SET_MESSAGE_INTERVAL
  512, // REQUEST_MESSAGE
  32000, // CAN_FORWARD
  42007, // SET_EKF_SOURCE_SET
]);

/** Resends of a silent command within its timeout (so three transmissions in all). */
const MAX_SILENT_RESENDS = 2;

/** TEMPORARILY_REJECTED retries before the command fails. */
const MAX_REJECTED_RETRIES = 3;

export interface PendingCommand {
  command: number;
  resolve: (result: CommandResult) => void;
  timer: ReturnType<typeof setTimeout>;
  retryCount: number;
  /** When the first transmission went out (ms since epoch). */
  sentAt: number;
  /** COMMAND_LONG confirmation byte of the last transmission. */
  confirmation: number;
  /** Next resend of a silent command, while one is scheduled. */
  resendTimer?: ReturnType<typeof setTimeout>;
  frame: Uint8Array;
  sendFn: (data: Uint8Array) => void;
  timeoutMs: number;
  // The system id of the vehicle this command was addressed to. Incoming
  // COMMAND_ACKs from a different source sysid are ignored so a co-channel
  // vehicle's ack cannot resolve this drone's pending command.
  targetSys: number;
  // Who we sent as. An ack addressed to a different GCS on a shared link is
  // not ours to consume.
  sysId: number;
  compId: number;
  // COMMAND_INT has no confirmation byte, so its retry is a byte-identical
  // resend rather than a re-encode with an incremented confirmation.
  isCommandInt?: boolean;
  // Inputs retained so retries can re-encode the COMMAND_LONG with an
  // incremented confirmation byte rather than resending byte-identical frames.
  encodeArgs: {
    targetSys: number;
    targetComp: number;
    command: number;
    params: [number, number, number, number, number, number, number];
    sysId: number;
    compId: number;
  };
}

export type PendingCommands = Map<number, PendingCommand>;

/** Re-encode a pending COMMAND_LONG with its current confirmation byte. */
export function encodeLong(entry: PendingCommand): Uint8Array {
  const a = entry.encodeArgs;
  return encodeCommandLong(
    a.targetSys, a.targetComp, a.command,
    a.params[0], a.params[1], a.params[2], a.params[3],
    a.params[4], a.params[5], a.params[6],
    a.sysId, a.compId,
    entry.confirmation,
  );
}

/** Re-encode a COMMAND_LONG's inputs as the equivalent COMMAND_INT frame. */
function encodeLongAsCommandInt(a: PendingCommand["encodeArgs"]): Uint8Array {
  const locationFrame: number | undefined = LONG_LOCATION_COMMAND_FRAME[a.command];
  const scale = locationFrame === undefined ? 1 : 1e7;
  const x = Number.isNaN(a.params[4]) ? 0 : Math.trunc(a.params[4] * scale);
  const y = Number.isNaN(a.params[5]) ? 0 : Math.trunc(a.params[5] * scale);
  return encodeCommandInt(
    a.targetSys, a.targetComp, locationFrame ?? MAV_FRAME_GLOBAL_RELATIVE_ALT, a.command, 0, 0,
    a.params[0], a.params[1], a.params[2], a.params[3],
    x, y, a.params[6], a.sysId, a.compId,
  );
}

/**
 * Transmit `entry.frame`. A transport that throws (it dropped, or it cannot
 * carry a command) fails the command at once with the transport's own reason.
 * Returns false when the send failed.
 */
export function transmit(pending: PendingCommands, ticket: number, entry: PendingCommand): boolean {
  try {
    entry.sendFn(entry.frame);
    return true;
  } catch (err) {
    clearTimeout(entry.timer);
    clearTimeout(entry.resendTimer);
    pending.delete(ticket);
    entry.resolve({
      success: false,
      resultCode: -1,
      message: `Send failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return false;
  }
}

/**
 * Send a resend-safe command again each time a third of its timeout passes
 * without any COMMAND_ACK, at most {@link MAX_SILENT_RESENDS} times. Any ack
 * (IN_PROGRESS included) stops it: the vehicle has the command.
 */
export function armResend(pending: PendingCommands, ticket: number): void {
  const entry = pending.get(ticket);
  if (!entry || !RESEND_SAFE_COMMANDS.has(entry.command)) return;
  const interval = entry.timeoutMs / (MAX_SILENT_RESENDS + 1);
  let resends = 0;
  const tick = () => {
    entry.resendTimer = undefined;
    if (pending.get(ticket) !== entry || resends >= MAX_SILENT_RESENDS) return;
    resends++;
    if (!entry.isCommandInt) {
      entry.confirmation++;
      entry.frame = encodeLong(entry);
    }
    if (!transmit(pending, ticket, entry)) return;
    entry.resendTimer = setTimeout(tick, interval);
  };
  entry.resendTimer = setTimeout(tick, interval);
}

/**
 * TEMPORARILY_REJECTED: retry after 1 s, up to {@link MAX_REJECTED_RETRIES}
 * times. Returns false once the retries are spent (the caller resolves the
 * final result).
 */
export function retryTemporarilyRejected(pending: PendingCommands, ticket: number, entry: PendingCommand): boolean {
  if (entry.retryCount >= MAX_REJECTED_RETRIES) return false;
  clearTimeout(entry.timer);
  entry.retryCount++;
  // Re-encode the COMMAND_LONG with the confirmation byte incremented.
  // ArduPilot/PX4 distinguish a fresh command from a repeat by this byte;
  // resending confirmation=0 looks like a duplicate first attempt rather
  // than a confirmation.
  if (!entry.isCommandInt) {
    entry.confirmation++;
    entry.frame = encodeLong(entry);
  }
  setTimeout(() => {
    // Entry may have been cleared during the delay
    if (!pending.has(ticket)) return;
    entry.timer = setTimeout(() => {
      pending.delete(ticket);
      entry.resolve({
        success: false,
        resultCode: RESULT_TEMPORARILY_REJECTED,
        message: `Command ${entry.command} temporarily rejected after ${entry.retryCount} retries`,
      });
    }, entry.timeoutMs);
    transmit(pending, ticket, entry);
  }, 1000);
  return true;
}

/**
 * COMMAND_INT_ONLY: a flash-constrained ArduPilot build without COMMAND_LONG
 * handling acks every COMMAND_LONG this way. Re-send the same command once as
 * COMMAND_INT; its ack resolves this entry.
 */
export function resendAsCommandInt(pending: PendingCommands, ticket: number, entry: PendingCommand): void {
  clearTimeout(entry.timer);
  entry.isCommandInt = true;
  entry.frame = encodeLongAsCommandInt(entry.encodeArgs);
  entry.timer = setTimeout(() => {
    pending.delete(ticket);
    entry.resolve({
      success: false,
      resultCode: -1,
      message: `Command ${entry.command} timed out after COMMAND_INT resend`,
    });
  }, entry.timeoutMs);
  transmit(pending, ticket, entry);
}
