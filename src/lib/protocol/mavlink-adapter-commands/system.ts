/**
 * MAVLink adapter commands: reboot, parameters, raw commands, message rates and shell.
 * @module protocol/mavlink-adapter-commands/system
 */

import type { CommandResult } from '../types'
import { encodeSerialControl } from '../encoders'
import type { CommandContext } from './context'

export function cmdSendCommand(ctx: CommandContext, commandId: number, params: number[]): Promise<CommandResult> {
  const p: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < Math.min(7, params.length); i++) p[i] = params[i]
  return ctx.sendCommandLong(commandId, p)
}
export function cmdRebootToBootloader(ctx: CommandContext): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  ctx.commandQueue.sendCommandNoAck(
    246, [3, 0, 0, 0, 0, 0, 0],
    (data) => ctx.transport!.send(data),
    ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId,
  )
  return {
    success: true,
    resultCode: 0,
    acknowledged: false,
    message: 'Bootloader reboot command sent, unacknowledged',
  }
}

export function cmdReboot(ctx: CommandContext): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  ctx.commandQueue.sendCommandNoAck(
    246, [1, 0, 0, 0, 0, 0, 0],
    (data) => ctx.transport!.send(data),
    ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId,
  )
  return {
    success: true,
    resultCode: 0,
    acknowledged: false,
    message: 'Reboot command sent, unacknowledged',
  }
}

export function cmdResetParametersToDefault(ctx: CommandContext): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  // MAV_CMD_PREFLIGHT_STORAGE (245). param1 = 2 resets parameter storage to
  // defaults; param2 is the MISSION storage action and 0 means "no action".
  // It used to pass -1, which is outside the enum — a receiver is free to
  // interpret that however it likes, including wiping the mission.
  ctx.commandQueue.sendCommandNoAck(
    245, [2, 0, 0, 0, 0, 0, 0],
    (data) => ctx.transport!.send(data),
    ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId,
  )
  return {
    success: true,
    resultCode: 0,
    acknowledged: false,
    message: 'Reset command sent, unacknowledged',
  }
}
export function cmdCommitParamsToFlash(ctx: CommandContext): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  // Deliberately fire-and-forget: ArduPilot writes PARAM_SET straight to
  // EEPROM, so this is a belt-and-braces PREFLIGHT_STORAGE and no caller may
  // block on its ack. What was wrong is the RETURN VALUE — an unconditional
  // `success: true` that surfaces rendered as "written to flash" for a write
  // nothing confirmed. `acknowledged: false` is the honest shape; do not add
  // an ack wait here.
  ctx.commandQueue.sendCommandNoAck(
    245, [1, 0, 0, 0, 0, 0, 0],
    (data) => ctx.transport!.send(data),
    ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId,
  )
  return {
    success: true,
    resultCode: 0,
    acknowledged: false,
    message: 'Flash commit command sent, unacknowledged',
  }
}
export function cmdDoPreArmCheck(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(401, [0, 0, 0, 0, 0, 0, 0])
}
export function cmdRequestMessage(ctx: CommandContext, msgId: number): Promise<CommandResult> {
  return ctx.sendCommandLong(512, [msgId, 0, 0, 0, 0, 0, 0])
}

export function cmdSetMessageInterval(ctx: CommandContext, msgId: number, intervalUs: number): Promise<CommandResult> {
  return ctx.sendCommandLong(511, [msgId, intervalUs, 0, 0, 0, 0, 0])
}

/** SERIAL_CONTROL carries at most this many data bytes per frame. */
const SERIAL_CONTROL_DATA_MAX = 70

/**
 * Send one shell line. A line longer than one SERIAL_CONTROL frame goes out as
 * consecutive frames, so the shell receives every byte and the newline.
 */
export function cmdSendSerialData(ctx: CommandContext, text: string): void {
  if (!ctx.transport?.isConnected) return
  const bytes = new TextEncoder().encode(text + '\n')
  for (let offset = 0; offset < bytes.length; offset += SERIAL_CONTROL_DATA_MAX) {
    const chunk = bytes.subarray(offset, offset + SERIAL_CONTROL_DATA_MAX)
    ctx.transport.send(encodeSerialControl(10, 6, 500, 0, chunk, ctx.sysId, ctx.compId))
  }
}
