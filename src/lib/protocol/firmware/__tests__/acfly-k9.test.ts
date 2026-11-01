import { describe, expect, it } from 'vitest'
import { createFirmwareHandlerByType } from '../ardupilot'
import { acflyK9Handler, packACFlyK9FlightMode } from '../acfly-k9'

describe('ACFly K9 firmware handler', () => {
  it('decodes the documented main and submode bytes from HEARTBEAT.custom_mode', () => {
    expect(acflyK9Handler.decodeFlightMode(packACFlyK9FlightMode(2, 0))).toBe('ALT_HOLD')
    expect(acflyK9Handler.decodeFlightMode(packACFlyK9FlightMode(3, 0))).toBe('POSHOLD')
    expect(acflyK9Handler.decodeFlightMode(packACFlyK9FlightMode(3, 2))).toBe('ACFLYK9_POSHOLD_AVOID')
    expect(acflyK9Handler.decodeFlightMode(packACFlyK9FlightMode(4, 3))).toBe('FOLLOW')
    expect(acflyK9Handler.decodeFlightMode(packACFlyK9FlightMode(4, 4))).toBe('MISSION')
    expect(acflyK9Handler.decodeFlightMode(packACFlyK9FlightMode(4, 5))).toBe('RTL')
    expect(acflyK9Handler.decodeFlightMode(packACFlyK9FlightMode(4, 6))).toBe('LAND')
    expect(acflyK9Handler.decodeFlightMode(packACFlyK9FlightMode(6, 0))).toBe('OFFBOARD')
    expect(acflyK9Handler.decodeFlightMode(packACFlyK9FlightMode(4, 2))).toBe('TAKEOFF')
    expect(acflyK9Handler.decodeFlightMode(packACFlyK9FlightMode(4, 99))).toBe('UNKNOWN')
  })

  it('encodes the two mode parameters documented for COMMAND_LONG 176', () => {
    expect(acflyK9Handler.encodeFlightMode('ACFLYK9_POSHOLD_AVOID')).toEqual({
      baseMode: 1,
      customMode: 3,
      customSubMode: 2,
    })
    expect(acflyK9Handler.encodeFlightMode('RTL')).toEqual({
      baseMode: 1,
      customMode: 4,
      customSubMode: 5,
    })
    expect(() => acflyK9Handler.encodeFlightMode('TAKEOFF')).toThrow()
    expect(() => acflyK9Handler.encodeFlightMode('AUTO')).toThrow()
  })

  it('exposes only protocol-documented K9 capabilities and the 10 Hz stick rate', () => {
    const capabilities = acflyK9Handler.getCapabilities()
    expect(capabilities.supportsArming).toBe(true)
    expect(capabilities.supportsMissionUpload).toBe(true)
    expect(capabilities.supportsMissionDownload).toBe(true)
    expect(capabilities.supportsGeoFence).toBe(true)
    expect(capabilities.supportsParameters).toBe(true)
    expect(capabilities.manualControlHz).toBe(10)
    expect(capabilities.supportsFirmwareFlash).toBe(false)
    expect(capabilities.supportsCliShell).toBe(false)
  })

  it('can be selected by its firmware type', () => {
    expect(createFirmwareHandlerByType('acfly-k9')).toBe(acflyK9Handler)
  })
})
