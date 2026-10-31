/**
 * MAVLink adapter commands: sensor calibration and motor test.
 * @module protocol/mavlink-adapter-commands/calibration
 */

import type { CommandResult } from '../types'
import type { CommandContext } from './context'
import { isArduPilot, refuseNonArduPilot } from './context'

export function cmdStartCalibration(
  ctx: CommandContext,
  type: 'accel' | 'gyro' | 'compass' | 'level' | 'airspeed' | 'baro' | 'rc' | 'esc' | 'compassmot',
): Promise<CommandResult> {
  if (type === 'compass') {
    if (ctx.firmwareHandler?.firmwareType === 'px4') {
      return ctx.sendCommandLong(241, [0, 1, 0, 0, 0, 0, 0], 120000)
    }
    return ctx.sendCommandLong(42424, [0, 1, 0, 2, 0, 0, 0], 30000)
  }
  if (type === 'rc') {
    return Promise.resolve({ success: true, resultCode: 0, message: 'RC calibration ready — follow on-screen instructions' })
  }
  if (type === 'compassmot') {
    // PREFLIGHT_CALIBRATION param6 is ArduPilot's CompassMot slot; on other
    // firmware the command is accepted and does nothing recognisable.
    if (!isArduPilot(ctx)) return Promise.resolve(refuseNonArduPilot(ctx, 'CompassMot calibration'))
    return ctx.sendCommandLong(241, [0, 0, 0, 0, 0, 1, 0], 120000)
  }
  const params: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0]
  switch (type) {
    case 'gyro':     params[0] = 1; break
    case 'accel':    params[4] = 1; break
    case 'level':    params[4] = 2; break
    case 'airspeed': params[5] = 2; break
    case 'baro':     params[2] = 1; break
    case 'esc':      params[6] = 1; break
  }
  return ctx.sendCommandLong(241, params, 30000)
}

export function cmdConfirmAccelCalPos(ctx: CommandContext, position: number): void {
  if (!ctx.transport?.isConnected) return
  if (!isArduPilot(ctx)) return
  ctx.commandQueue.sendCommandNoAck(
    42429, [position, 0, 0, 0, 0, 0, 0],
    (data) => ctx.transport!.send(data),
    ctx.targetSysId, ctx.targetCompId,
    ctx.sysId, ctx.compId,
  )
}

export function cmdAcceptCompassCal(ctx: CommandContext, compassMask = 0): Promise<CommandResult> {
  if (!isArduPilot(ctx)) return Promise.resolve(refuseNonArduPilot(ctx, 'Accept compass calibration'))
  return ctx.sendCommandLong(42425, [compassMask, 0, 0, 0, 0, 0, 0])
}

export function cmdCancelCompassCal(ctx: CommandContext, compassMask = 0): Promise<CommandResult> {
  if (!isArduPilot(ctx)) return Promise.resolve(refuseNonArduPilot(ctx, 'Cancel compass calibration'))
  return ctx.sendCommandLong(42426, [compassMask, 0, 0, 0, 0, 0, 0])
}

export function cmdCancelCalibration(ctx: CommandContext): Promise<CommandResult> {
  // PREFLIGHT_CALIBRATION with all-zero params is the standard cancel across
  // every firmware, so this one is deliberately not gated.
  return ctx.sendCommandLong(241, [0, 0, 0, 0, 0, 0, 0])
}

/**
 * MAV_CMD_FIXED_MAG_CAL_YAW (42006), common.xml: calibrate the compass from
 * the world magnetic model and a KNOWN vehicle yaw. param1 is the vehicle's
 * earth-frame yaw in degrees; param2 0 = every compass; param3/param4 0,0 =
 * the vehicle's current location. ArduPilot and PX4 both implement it.
 *
 * The yaw is required: 0 is not "unknown" but "the nose points north", and
 * calibrating a vehicle that faces anywhere else against north corrupts its
 * heading by exactly that error.
 */
export function cmdStartGnssMagCal(ctx: CommandContext, yawDeg: number): Promise<CommandResult> {
  if (!Number.isFinite(yawDeg) || yawDeg < 0 || yawDeg >= 360) {
    return Promise.resolve({
      success: false,
      resultCode: -1,
      message: 'Known-heading compass calibration needs the vehicle yaw in degrees (0-359)',
    })
  }
  return ctx.sendCommandLong(42006, [yawDeg, 0, 0, 0, 0, 0, 0])
}
export function cmdMotorTest(ctx: CommandContext, motor: number, throttle: number, duration: number): Promise<CommandResult> {
  return ctx.sendCommandLong(209, [motor, 0, throttle, duration, 0, 0, 0])
}
