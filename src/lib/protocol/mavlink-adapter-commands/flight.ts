/**
 * MAVLink adapter commands: arm, modes, navigation and guided flight.
 * @module protocol/mavlink-adapter-commands/flight
 */

import type { CommandResult, UnifiedFlightMode, GuidedGotoOptions } from '../types'
import { encodeACFlyK9ManualControl, encodeACFlyK9SetHomePosition, encodeManualControl, encodeSetGpsGlobalOrigin } from '../encoders'
import type { CommandContext } from './context'
import { MAV_FRAME_GLOBAL } from './context'

export function cmdArm(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(400, [1, 0, 0, 0, 0, 0, 0])
}

export function cmdDisarm(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(400, [0, 0, 0, 0, 0, 0, 0])
}

export function cmdSetFlightMode(ctx: CommandContext, mode: UnifiedFlightMode): Promise<CommandResult> {
  if (!ctx.firmwareHandler) {
    return Promise.resolve({ success: false, resultCode: -1, message: 'No firmware handler' })
  }
  const encodedMode = ctx.firmwareHandler.encodeFlightMode(mode)
  const { baseMode, customMode } = encodedMode
  if (encodedMode.customSubMode !== undefined) {
    return ctx.sendCommandLong(176, [
      encodedMode.baseMode,
      encodedMode.customMode,
      encodedMode.customSubMode,
      0, 0, 0, 0,
    ])
  }
  // PX4 reads DO_SET_MODE with the two mode levels de-packed: param2 = main_mode,
  // param3 = sub_mode. It casts the low byte of param2 to the main mode, so the
  // packed custom_mode value would be read as main 0 and rejected. The packed
  // layout (main in bits 16-23, sub in bits 24-31) is only for the custom_mode
  // field (HEARTBEAT / SET_MODE), not this command. ArduPilot keeps the flat
  // custom_mode number in param2.
  if (ctx.firmwareHandler.firmwareType === 'px4') {
    const mainMode = (customMode >>> 16) & 0xff
    const subMode = (customMode >>> 24) & 0xff
    return ctx.sendCommandLong(176, [baseMode, mainMode, subMode, 0, 0, 0, 0])
  }
  return ctx.sendCommandLong(176, [baseMode, customMode, 0, 0, 0, 0, 0])
}

export function cmdReturnToLaunch(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(20, [0, 0, 0, 0, 0, 0, 0])
}

/**
 * MAV_CMD_NAV_LAND (21).
 *
 * `at` rides in x/y of a COMMAND_INT, but it is not a landing target the
 * autopilot will fly to: ArduCopter handles this command by switching to LAND
 * mode, which descends at the vehicle's current position and ignores x/y. A
 * caller that wants to land somewhere else has to reposition first and send
 * this only once the vehicle is holding over the point (the map's "Land Here"
 * sequence does exactly that).
 */
export function cmdLand(ctx: CommandContext, at?: { lat: number; lon: number }): Promise<CommandResult> {
  if (ctx.firmwareHandler?.firmwareType === 'acfly-k9') {
    if (at) {
      return Promise.resolve({
        success: false,
        resultCode: 3,
        message: 'ACFly K9 NAV_LAND uses the documented fixed location sentinels; land-at coordinates are not supported',
      })
    }
    return ctx.sendCommandLong(21, [0, 0, 0, 0, 1000, 1000, 0])
  }
  if (!at) return ctx.sendCommandLong(21, [0, 0, 0, 0, 0, 0, 0])
  return ctx.sendCommandInt(21, [0, 0, 0, 0], Math.round(at.lat * 1e7), Math.round(at.lon * 1e7), 0, 3)
}

/**
 * MAV_CMD_NAV_TAKEOFF (22) to `altitude` metres above home.
 *
 * ArduPilot reads param7 as a height above home. PX4 stores param7 verbatim
 * as an AMSL altitude and refuses to descend to one below the vehicle, so a
 * height above home sent as-is takes off to the current altitude instead.
 * For PX4 the height is converted with the home altitude, and param4-6 are
 * NaN: "no yaw" and "take off from the current position".
 */
export function cmdTakeoff(ctx: CommandContext, altitude: number): Promise<CommandResult> {
  if (ctx.firmwareHandler?.firmwareType === 'acfly-k9') {
    return ctx.sendCommandLong(24, [0, 0, 0, 0, 0, 0, altitude])
  }
  if (ctx.firmwareHandler?.firmwareType === 'px4') {
    if (ctx.homeAltitudeAmsl === null) {
      return Promise.resolve({
        success: false,
        resultCode: -1,
        message: 'Takeoff refused: PX4 takes an AMSL takeoff altitude and the vehicle has not reported its home position yet',
      })
    }
    return ctx.sendCommandLong(22, [0, 0, 0, Number.NaN, Number.NaN, Number.NaN, ctx.homeAltitudeAmsl + altitude])
  }
  return ctx.sendCommandLong(22, [0, 0, 0, 0, 0, 0, altitude])
}

/**
 * MANUAL_CONTROL from a normalized stick frame. Roll, pitch, and yaw are -1..1
 * and map to the full -1000..1000 axis range. K9 uses the same signed range
 * for throttle and its MAVLink 2 extension fields; other firmware retains the
 * standard non-reversing 0..1000 throttle mapping.
 */
export function cmdSendManualControl(ctx: CommandContext, roll: number, pitch: number, throttle: number, yaw: number, buttons: number): void {
  if (!ctx.transport?.isConnected) return
  const clampAxis = (v: number) => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0))
  const x = Math.round(clampAxis(pitch) * 1000)
  const y = Math.round(clampAxis(roll) * 1000)
  if (ctx.firmwareHandler?.firmwareType === 'acfly-k9') {
    const throttleInput = Number.isFinite(throttle) ? throttle : 0.5
    const z = Math.round(clampAxis(throttleInput * 2 - 1) * 1000)
    const r = Math.round(clampAxis(yaw) * 1000)
    ctx.transport.send(encodeACFlyK9ManualControl(ctx.targetSysId, x, y, z, r, buttons, ctx.sysId, ctx.compId))
    return
  }
  const z = Math.round(Math.max(0, Math.min(1, Number.isFinite(throttle) ? throttle : 0)) * 1000)
  const r = Math.round(clampAxis(yaw) * 1000)
  ctx.transport.send(encodeManualControl(ctx.targetSysId, x, y, z, r, buttons, ctx.sysId, ctx.compId))
}
/**
 * MAV_CMD_DO_FLIGHTTERMINATION. Irreversible in flight: it cuts the outputs
 * and the airframe falls.
 *
 * The protocol layer will not guess whether an operator meant it, so the
 * confirmation is the CALLER's job and this signature makes that explicit
 * rather than accepting a bare click. `confirmed` must come from a real
 * operator confirmation (the armed-write confirm dialog), never a default.
 */
export function cmdKillSwitch(ctx: CommandContext, confirmed: boolean): Promise<CommandResult> {
  if (!confirmed) {
    return Promise.resolve({
      success: false,
      resultCode: -1,
      message: 'Flight termination requires explicit confirmation',
    })
  }
  return ctx.sendCommandLong(185, [1, 0, 0, 0, 0, 0, 0])
}

export function cmdGuidedGoto(
  ctx: CommandContext,
  lat: number,
  lon: number,
  alt: number,
  options?: GuidedGotoOptions,
): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) {
    return Promise.resolve({ success: false, resultCode: -1, message: 'Not connected' })
  }
  if (ctx.firmwareHandler?.firmwareType === 'acfly-k9') {
    const changeMode = options?.changeMode ?? true
    return ctx.sendCommandInt(
      192,
      [-1, (changeMode ? 1 : 0) | 2, 0, Number.NaN],
      Math.round(lat * 1e7),
      Math.round(lon * 1e7),
      alt,
      0,
    )
  }
  // MAV_CMD_DO_REPOSITION (192) as a COMMAND_INT so lat/lon keep 1e7 integer
  // precision. It used to be a raw transport write that reported success on
  // the WRITE, so a rejected or unsupported reposition read as accepted; it is
  // ack-tracked now like every other flight-affecting command.
  // param2 bit 0 is MAV_DO_REPOSITION_FLAGS_CHANGE_MODE: set, the autopilot
  // enters its guided mode from whatever mode it is in. A streaming caller
  // clears it after the first reposition so it cannot override a mode change.
  // param3 (plane loiter radius) and param4 (yaw) are NaN: the spec reads NaN
  // as "keep the current behaviour", while 0 is a real yaw (north) that PX4
  // turns the aircraft to on arrival.
  const changeMode = options?.changeMode ?? true
  return ctx.sendCommandInt(
    192,
    [-1, changeMode ? 1 : 0, Number.NaN, Number.NaN],
    Math.round(lat * 1e7),
    Math.round(lon * 1e7),
    alt,
    6, // MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
  )
}

export function cmdPauseMission(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(193, [0, 0, 0, 0, 0, 0, 0])
}

export function cmdResumeMission(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(193, [1, 0, 0, 0, 0, 0, 0])
}
/**
 * MAV_CMD_DO_SET_HOME (179) as an ack-tracked COMMAND_INT, so the location
 * keeps 1e7 integer precision. `alt` is AMSL (MAV_FRAME_GLOBAL). ArduPilot and
 * PX4 both accept an explicit location (param1 = 0); param4 is the home yaw
 * on PX4, where NaN leaves it unset rather than pointing home north.
 */
export function cmdSetHome(
  ctx: CommandContext,
  useCurrent: boolean,
  lat = 0,
  lon = 0,
  alt = 0,
  approach?: { lat: number; lon: number; alt: number },
): Promise<CommandResult> {
  if (ctx.firmwareHandler?.firmwareType === 'acfly-k9') {
    if (useCurrent) {
      return Promise.resolve({
        success: false,
        resultCode: 3,
        message: 'ACFly K9 SET_HOME_POSITION requires explicit coordinates; current-position home is not defined by its protocol',
      })
    }
    if (!ctx.transport?.isConnected) {
      return Promise.resolve({ success: false, resultCode: -1, message: 'Not connected' })
    }
    ctx.transport.send(encodeACFlyK9SetHomePosition(
      Math.round(lat * 1e7),
      Math.round(lon * 1e7),
      Math.round(alt * 1000),
      ctx.targetSysId,
      Date.now() * 1000,
      approach && {
        latitudeE7: Math.round(approach.lat * 1e7),
        longitudeE7: Math.round(approach.lon * 1e7),
        altitudeMm: Math.round(approach.alt * 1000),
      },
      ctx.sysId,
      ctx.compId,
    ))
    return Promise.resolve({ success: true, resultCode: 0, message: 'ACFly K9 SET_HOME_POSITION sent' })
  }
  if (approach) {
    return Promise.resolve({
      success: false,
      resultCode: 3,
      message: `Approach-point home configuration is not supported by ${ctx.firmwareHandler?.firmwareType ?? 'unknown firmware'}`,
    })
  }
  if (useCurrent) {
    return ctx.sendCommandInt(179, [1, 0, 0, Number.NaN], 0, 0, 0, MAV_FRAME_GLOBAL)
  }
  return ctx.sendCommandInt(179, [0, 0, 0, Number.NaN], Math.round(lat * 1e7), Math.round(lon * 1e7), alt, MAV_FRAME_GLOBAL)
}

export function cmdChangeSpeed(ctx: CommandContext, speedType: number, speed: number): Promise<CommandResult> {
  return ctx.sendCommandLong(178, [speedType, speed, -1, 0, 0, 0, 0])
}

export function cmdSetYaw(ctx: CommandContext, angle: number, speed: number, direction: number, relative: boolean): Promise<CommandResult> {
  return ctx.sendCommandLong(115, [angle, speed, direction, relative ? 1 : 0, 0, 0, 0])
}

export function cmdSetGeoFenceEnabled(ctx: CommandContext, enabled: boolean): Promise<CommandResult> {
  return ctx.sendCommandLong(207, [enabled ? 1 : 0, 0, 0, 0, 0, 0, 0])
}
export function cmdEnableFence(ctx: CommandContext, enable: boolean): Promise<CommandResult> {
  // One implementation, one command number. This used to send 217, which is
  // not in the MAV_CMD enum at all, while cmdSetGeoFenceEnabled sent the real
  // MAV_CMD_DO_FENCE_ENABLE (207) for the same operator intent.
  return cmdSetGeoFenceEnabled(ctx, enable)
}

export function cmdDoLandStart(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(189, [0, 0, 0, 0, 0, 0, 0])
}
/**
 * MAV_CMD_DO_ORBIT (34) — orbit a GPS coordinate.
 *
 * Ack-tracked COMMAND_INT, for the same reason as the ROI command above: an
 * orbit the vehicle refused used to report "Orbit command sent".
 */
export function cmdOrbit(ctx: CommandContext, radius: number, velocity: number, yawBehavior: number, lat: number, lon: number, alt: number): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) {
    return Promise.resolve({ success: false, resultCode: -1, message: 'Not connected' })
  }
  // yawBehavior (ORBIT_YAW_BEHAVIOUR): 0=HOLD_FRONT_TO_CIRCLE_CENTER,
  // 1=HOLD_INITIAL_HEADING, 2=UNCONTROLLED, 3=HOLD_FRONT_TANGENT_TO_CIRCLE,
  // 4=RC_CONTROLLED, 5=UNCHANGED
  return ctx.sendCommandInt(
    34,
    [radius, velocity, yawBehavior, 0],
    Math.round(lat * 1e7),
    Math.round(lon * 1e7),
    alt,
    6, // MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
  )
}

/**
 * SET_GPS_GLOBAL_ORIGIN (message 48) — set the EKF origin.
 *
 * 48 is a MAVLink message, not a MAV_CMD, so the flight controller adopts the
 * origin on receipt without returning a COMMAND_ACK. The result reports only
 * whether the message left the transport; there is no confirmation that the
 * origin was accepted.
 */
export function cmdSetEkfOrigin(ctx: CommandContext, lat: number, lon: number, alt: number): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  const frame = encodeSetGpsGlobalOrigin(
    ctx.targetSysId,
    Math.round(lat * 1e7), Math.round(lon * 1e7), Math.round(alt * 1000),
    ctx.sysId, ctx.compId,
  )
  try {
    ctx.transport.send(frame)
  } catch (err) {
    return { success: false, resultCode: -1, message: `Send failed: ${err instanceof Error ? err.message : String(err)}` }
  }
  return { success: true, resultCode: 0, message: 'EKF origin sent (unconfirmed; no ACK for this message)' }
}
