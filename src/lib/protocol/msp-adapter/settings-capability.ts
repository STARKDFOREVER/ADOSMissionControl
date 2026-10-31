/**
 * Settings capability adapter over the typed MSP settings client.
 *
 * @module protocol/msp-adapter/settings-capability
 */

import type { SettingsCapability } from '../types'
import type { SettingsClient } from '../msp/settings'

/**
 * Wrap a connected `SettingsClient` as the firmware-agnostic
 * `SettingsCapability` exposed on `DroneProtocol.settings`.
 */
export function makeSettingsCapability(client: SettingsClient): SettingsCapability {
  return {
    getSetting: (name) => client.get(name),
    setSetting: async (name, value) => {
      try {
        await client.set(name, value)
        return { success: true, resultCode: 0, message: 'OK' }
      } catch (err) {
        return { success: false, resultCode: -1, message: err instanceof Error ? err.message : String(err) }
      }
    },
    getSettingInfo: (name) => client.getInfo(name),
    enumerate: () => client.enumerateAllSettings(),
  }
}
