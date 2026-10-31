/**
 * MSP connect handshake: identify the flight controller and read the mode
 * and receiver configuration the adapter needs before it starts polling.
 *
 * @module protocol/msp-adapter/handshake
 */

import type { MspSerialQueue } from '../msp/msp-serial-queue'
import { MSP, FEATURE_FLAG } from '../msp/msp-constants'
import { buildBoxMap, parseModeRanges, type ModeRange } from '../msp/msp-mode-map'
import { decodeMspBoardInfo } from '../msp/msp-decoders-status'

function u8(buf: Uint8Array, offset: number): number { return buf[offset] }

/** What the handshake learned about the connected flight controller. */
export interface MspFcIdentity {
  apiVersionMajor: number
  apiVersionMinor: number
  variantStr: string
  firmwareVersionString: string
  boardInfo: ReturnType<typeof decodeMspBoardInfo>
  boxIds: number[]
  modeRanges: ModeRange[]
  /** True only when the FC's receiver provider is MSP. */
  rxMspEnabled: boolean
}

export async function mspIdentify(queue: MspSerialQueue): Promise<MspFcIdentity> {
  const apiVersionFrame = await queue.send(MSP.MSP_API_VERSION)
  const apiVersionMajor = u8(apiVersionFrame.payload, 1)
  const apiVersionMinor = u8(apiVersionFrame.payload, 2)

  const variantFrame = await queue.send(MSP.MSP_FC_VARIANT)
  const variantStr = String.fromCharCode(...variantFrame.payload)

  const versionFrame = await queue.send(MSP.MSP_FC_VERSION)
  const vP = versionFrame.payload
  const firmwareVersionString = `${variantStr} ${u8(vP, 0)}.${u8(vP, 1)}.${u8(vP, 2)} (MSP API ${apiVersionMajor}.${apiVersionMinor})`

  const boardInfoFrame = await queue.send(MSP.MSP_BOARD_INFO)
  const boardInfo = decodeMspBoardInfo(new DataView(boardInfoFrame.payload.buffer, boardInfoFrame.payload.byteOffset, boardInfoFrame.payload.byteLength))

  const boxNamesFrame = await queue.send(MSP.MSP_BOXNAMES)
  const boxNames = String.fromCharCode(...boxNamesFrame.payload).split(';').filter(n => n.length > 0)

  const boxIdsFrame = await queue.send(MSP.MSP_BOXIDS)
  const boxIds = Array.from(boxIdsFrame.payload)
  buildBoxMap(boxNames, boxIds)

  let modeRanges: ModeRange[] = []
  try {
    const modeRangesFrame = await queue.send(MSP.MSP_MODE_RANGES)
    modeRanges = parseModeRanges(modeRangesFrame.payload)
  } catch { modeRanges = [] }

  // MSP_SET_RAW_RC only reaches rcData[] when the receiver provider is MSP.
  // With any other receiver the FC parses the frame and discards it, so an
  // override that reported success would be describing nothing. A feature
  // word we could not read is not evidence either way, so it reads as off.
  let rxMspEnabled = false
  try {
    const featureFrame = await queue.send(MSP.MSP_FEATURE_CONFIG)
    const fp = featureFrame.payload
    const features = fp.length >= 4
      ? ((fp[0] | (fp[1] << 8) | (fp[2] << 16) | (fp[3] << 24)) >>> 0)
      : 0
    rxMspEnabled = ((features >>> FEATURE_FLAG.RX_MSP) & 1) === 1
  } catch { rxMspEnabled = false }

  return { apiVersionMajor, apiVersionMinor, variantStr, firmwareVersionString, boardInfo, boxIds, modeRanges, rxMspEnabled }
}
