/**
 * ACFly K9 firmware handler.
 *
 * K9 reports its main and sub flight modes in the third and fourth bytes of
 * HEARTBEAT.custom_mode. The same values are sent separately as COMMAND_LONG
 * parameters 2 and 3 when changing mode.
 *
 * @module firmware/acfly-k9
 */

import type {
  FirmwareType,
  FirmwareHandler,
  UnifiedFlightMode,
  VehicleClass,
  ProtocolCapabilities,
} from '../types'
import { NO_CAPABILITIES } from '../no-capabilities'

export const ACFLYK9_BOARD_VERSION = 5

const ACFLYK9_CAPABILITIES: ProtocolCapabilities = {
  ...NO_CAPABILITIES,
  supportsArming: true,
  supportsFlightModes: true,
  supportsMissionUpload: true,
  supportsMissionDownload: true,
  supportsManualControl: true,
  supportsParameters: true,
  supportsAutonomousNav: true,
  supportsGeoFence: true,
  supportsRally: true,
  supportsGimbal: true,
  supportsBattery2: true,
  supportsRangefinder: true,
  manualControlHz: 10,
}

type ACFlyK9Mode = {
  main: number
  sub: number
  mode: UnifiedFlightMode
  requestable: boolean
}

const ACFLYK9_MODES: readonly ACFlyK9Mode[] = [
  { main: 2, sub: 0, mode: 'ALT_HOLD', requestable: true },
  { main: 3, sub: 0, mode: 'POSHOLD', requestable: true },
  { main: 3, sub: 2, mode: 'ACFLYK9_POSHOLD_AVOID', requestable: true },
  { main: 4, sub: 2, mode: 'TAKEOFF', requestable: false },
  { main: 4, sub: 3, mode: 'FOLLOW', requestable: true },
  { main: 4, sub: 4, mode: 'MISSION', requestable: true },
  { main: 4, sub: 5, mode: 'RTL', requestable: true },
  { main: 4, sub: 6, mode: 'LAND', requestable: true },
  { main: 6, sub: 0, mode: 'OFFBOARD', requestable: true },
]

function packMode(main: number, sub: number): number {
  return ((main & 0xff) << 16) | ((sub & 0xff) << 24)
}

class ACFlyK9Handler implements FirmwareHandler {
  readonly firmwareType: FirmwareType = 'acfly-k9'
  readonly vehicleClass: VehicleClass = 'unknown'

  encodeFlightMode(mode: UnifiedFlightMode): { baseMode: number; customMode: number; customSubMode?: number } {
    const entry = ACFLYK9_MODES.find((candidate) => candidate.mode === mode && candidate.requestable)
    if (!entry) throw new Error(`Unsupported mode for ACFly K9: ${mode}`)
    return { baseMode: 1, customMode: entry.main, customSubMode: entry.sub }
  }

  decodeFlightMode(customMode: number): UnifiedFlightMode {
    const main = (customMode >>> 16) & 0xff
    const sub = (customMode >>> 24) & 0xff
    return ACFLYK9_MODES.find((entry) => entry.main === main && entry.sub === sub)?.mode ?? 'UNKNOWN'
  }

  getAvailableModes(): UnifiedFlightMode[] {
    return ACFLYK9_MODES.filter((entry) => entry.requestable).map((entry) => entry.mode)
  }

  getDefaultMode(): UnifiedFlightMode {
    return 'ALT_HOLD'
  }

  getSupportedMissionCommands(): number[] {
    return [
      16,   // NAV_WAYPOINT
      20,   // NAV_RETURN_TO_LAUNCH
      21,   // NAV_LAND
      22,   // NAV_TAKEOFF
      112,  // NAV_DELAY
      177,  // DO_JUMP
      178,  // DO_CHANGE_SPEED
      183,  // DO_SET_SERVO / PWM payload
      206,  // DO_SET_CAM_TRIGG_DIST
      1000, // K9 gimbal attitude
      2000, // K9 camera capture
      2001, // K9 camera stop
    ]
  }

  getCapabilities(): ProtocolCapabilities {
    return ACFLYK9_CAPABILITIES
  }

  getFirmwareVersion(): string {
    return 'ACFly K9'
  }

  mapParameterName(canonical: string): string {
    return canonical
  }

  reverseMapParameterName(firmwareName: string): string {
    return firmwareName
  }
}

export const acflyK9Handler: FirmwareHandler = new ACFlyK9Handler()

export { packMode as packACFlyK9FlightMode }
