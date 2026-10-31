/**
 * MSP adapter: firmware configuration surfaces over the core link.
 * @module protocol/msp-adapter/adapter
 */

import type { DroneProtocol, CommandResult, LogDownloadProgressCallback } from '../types'
import { MSP } from '../msp/msp-constants'
import * as cmds from '../msp-adapter-commands'
import * as inav from '../msp-adapter-inav'
import * as bf from './bf-config'
import * as ranges from './ranges'
import type { MspSerialPort } from '../msp/decoders/config/serial'
import type { BfRxConfig } from '../msp/decoders/config/rx'
import type { MspOsdConfig, MspOsdGeneralConfig } from '../msp/decoders/config/osd'
import type { HsvColor, BfLedModeColor } from '@/lib/protocol/types/betaflight'
import { decodeMspDisplayPort, type DisplayPortOp } from '../msp/decoders/config/displayport'
import type { MspAdjustmentRange, MspModeBox, MspModeRange } from '../msp/msp-decoders-status'
import type { MspVtxTablePowerLevel } from '@/lib/protocol/types/betaflight'
import { getFlashSummary, downloadBlackboxLog, eraseBlackboxFlash, type BlackboxDownloadProgress } from '../msp/msp-blackbox'
import type { INavSafehome, INavGeozone, INavGeozoneVertex, INavActiveProfiles, INavBatteryConfig, INavMixer, INavServoConfig, INavMcBraking, INavRateDynamics, INavTimerOutputModeEntry, INavOutputMappingExt2Entry, INavTempSensorConfigEntry, INavCalibrationData, MotorMixerRule, INavServoMixerRule, INavFwApproach } from '@/lib/protocol/types/inav'
import { INAV_LIMITS } from '../msp/decoders/inav/constants'
import { MspAdapterCore } from './core'

/**
 * MSP adapter configuration surfaces: iNav navigation and tuning, mode and
 * adjustment ranges, logs, blackbox and Betaflight binary config.
 */
export class MSPAdapter extends MspAdapterCore implements DroneProtocol {
  /**
   * Run a config write, then MSP_EEPROM_WRITE. MSP config writes only change
   * the FC's RAM, so without the EEPROM write every change is lost at the
   * next power cycle. The result is a success only when both steps succeed.
   */
  private async persist(write: () => Promise<CommandResult>): Promise<CommandResult> {
    const result = await write()
    if (!result.success) return result
    const saved = await cmds.mspCommitParamsToFlash(this.cmdCtx)
    if (!saved.success) {
      return { success: false, resultCode: -1, message: `Written to the flight controller's RAM but not saved: ${saved.message}` }
    }
    return result
  }

  /** `persist` for uploads that report failure by throwing. */
  private async persistOrThrow(write: () => Promise<void>): Promise<void> {
    const result = await this.persist(async () => { await write(); return { success: true, resultCode: 0, message: 'OK' } })
    if (!result.success) throw new Error(result.message)
  }

  // ── iNav-specific methods ────────────────────────────────────
  async downloadSafehomes(): Promise<INavSafehome[]> { return inav.inavDownloadSafehomes(this.queue) }
  async uploadSafehomes(safehomes: INavSafehome[]): Promise<CommandResult> { return this.persist(() => inav.inavUploadSafehomes(this.queue, safehomes)) }
  async downloadGeozones(): Promise<{ zones: INavGeozone[]; vertices: INavGeozoneVertex[] }> { return inav.inavDownloadGeozones(this.queue) }
  async uploadGeozones(zones: INavGeozone[], vertices: INavGeozoneVertex[]): Promise<CommandResult> { return this.persist(() => inav.inavUploadGeozones(this.queue, zones, vertices)) }

  async getBatteryConfig(): Promise<INavBatteryConfig> { return inav.inavGetBatteryConfig(this.queue) }
  async setBatteryConfig(cfg: INavBatteryConfig): Promise<CommandResult> { return this.persist(() => inav.inavSetBatteryConfig(this.queue, cfg)) }
  // Profile selects are saved to EEPROM by the FC itself.
  async selectBatteryProfile(idx: number): Promise<CommandResult> { return inav.inavSelectBatteryProfile(this.queue, idx) }
  async getActiveProfiles(): Promise<INavActiveProfiles> { return inav.inavGetActiveProfiles(this.queue) }
  async selectControlProfile(idx: number): Promise<CommandResult> { return inav.inavSelectControlProfile(this.queue, idx) }
  async getMixerConfig(): Promise<INavMixer> { return inav.inavGetMixerConfig(this.queue) }
  async selectMixerProfile(idx: number): Promise<CommandResult> { return inav.inavSelectMixerProfile(this.queue, idx) }
  async getOutputMapping(): Promise<INavOutputMappingExt2Entry[]> { return inav.inavGetOutputMapping(this.queue) }
  async getTimerOutputModes(): Promise<INavTimerOutputModeEntry[]> { return inav.inavGetTimerOutputModes(this.queue) }
  async setTimerOutputMode(entries: INavTimerOutputModeEntry[]): Promise<CommandResult> {
    return this.persist(async () => {
      for (const entry of entries) {
        const r = await inav.inavSetTimerOutputMode(this.queue, entry)
        if (!r.success) return r
      }
      return { success: true, resultCode: 0, message: `${entries.length} timer output modes saved` }
    })
  }
  async getServoConfigs(): Promise<INavServoConfig[]> { return inav.inavGetServoConfigs(this.queue) }
  async setServoConfigs(cfgs: INavServoConfig[]): Promise<CommandResult> {
    return this.persist(async () => {
      for (let i = 0; i < cfgs.length; i++) {
        const r = await inav.inavSetServoConfig(this.queue, i, cfgs[i])
        if (!r.success) return r
      }
      return { success: true, resultCode: 0, message: `${cfgs.length} servo configs saved` }
    })
  }
  async getTempSensorConfigs(): Promise<INavTempSensorConfigEntry[]> { return inav.inavGetTempSensorConfigs(this.queue) }
  async getTemperatures(): Promise<(number | null)[]> { return inav.inavGetTemperatures(this.queue) }
  async getCalibrationData(): Promise<INavCalibrationData> { return inav.inavGetCalibrationData(this.queue) }
  async getMcBraking(): Promise<INavMcBraking> { return inav.inavGetMcBraking(this.queue) }
  async setMcBraking(b: INavMcBraking): Promise<CommandResult> { return this.persist(() => inav.inavSetMcBraking(this.queue, b)) }
  async getRateDynamics(): Promise<INavRateDynamics> { return inav.inavGetRateDynamics(this.queue) }
  async setRateDynamics(r: INavRateDynamics): Promise<CommandResult> { return this.persist(() => inav.inavSetRateDynamics(this.queue, r)) }
  async getEzTune() { return inav.inavGetEzTune(this.queue) }
  async setEzTune(cfg: Parameters<typeof inav.inavSetEzTune>[1]) { return this.persist(() => inav.inavSetEzTune(this.queue, cfg)) }
  async getFwApproach(): Promise<INavFwApproach[]> {
    const approaches: INavFwApproach[] = []
    for (let i = 0; i < INAV_LIMITS.FW_APPROACHES; i++) {
      approaches.push(await inav.inavGetFwApproach(this.queue, i))
    }
    return approaches
  }
  async setFwApproach(a: Parameters<typeof inav.inavSetFwApproach>[1]) { return this.persist(() => inav.inavSetFwApproach(this.queue, a)) }
  async getOsdLayoutsHeader() { return inav.inavGetOsdLayoutsHeader(this.queue) }
  async getOsdAlarms() { return inav.inavGetOsdAlarms(this.queue) }
  async setOsdAlarms(a: Parameters<typeof inav.inavSetOsdAlarms>[1]) { return this.persist(() => inav.inavSetOsdAlarms(this.queue, a)) }
  async getOsdPreferences() { return inav.inavGetOsdPreferences(this.queue) }
  async setOsdPreferences(p: Parameters<typeof inav.inavSetOsdPreferences>[1]) { return this.persist(() => inav.inavSetOsdPreferences(this.queue, p)) }
  async getCustomOsdElements() { return inav.inavGetCustomOsdElements(this.queue) }
  async setCustomOsdElement(el: Parameters<typeof inav.inavSetCustomOsdElement>[1]) { return this.persist(() => inav.inavSetCustomOsdElement(this.queue, el)) }
  async downloadLogicConditions() { return inav.inavDownloadLogicConditions(this.queue) }
  async uploadLogicConditions(rules: Parameters<typeof inav.inavUploadLogicCondition>[2][]): Promise<CommandResult> {
    return this.persist(async () => {
      for (let i = 0; i < rules.length; i++) {
        const r = await inav.inavUploadLogicCondition(this.queue, i, rules[i])
        if (!r.success) return { ...r, message: `Logic condition ${i}: ${r.message}` }
      }
      return { success: true, resultCode: 0, message: `${rules.length} logic conditions saved` }
    })
  }
  async downloadLogicConditionsStatus() { return inav.inavDownloadLogicConditionsStatus(this.queue) }
  async downloadGvarStatus() { return inav.inavDownloadGvarStatus(this.queue) }
  // A live runtime value, not stored config: no EEPROM write.
  async setGvar(index: number, value: number) { return inav.inavSetGvar(this.queue, index, value) }
  async downloadProgrammingPids() { return inav.inavDownloadProgrammingPids(this.queue) }
  async uploadProgrammingPids(pids: Parameters<typeof inav.inavUploadProgrammingPid>[2][]): Promise<CommandResult> {
    return this.persist(async () => {
      for (let i = 0; i < pids.length; i++) {
        const r = await inav.inavUploadProgrammingPid(this.queue, i, pids[i])
        if (!r.success) return { ...r, message: `Programming PID ${i}: ${r.message}` }
      }
      return { success: true, resultCode: 0, message: `${pids.length} programming PIDs saved` }
    })
  }
  async downloadProgrammingPidStatus() { return inav.inavDownloadProgrammingPidStatus(this.queue) }
  async downloadMotorMixer(): Promise<MotorMixerRule[]> { return inav.inavDownloadMotorMixer(this.queue) }
  async uploadMotorMixer(rules: MotorMixerRule[]): Promise<void> { return this.persistOrThrow(() => inav.inavUploadMotorMixer(this.queue, rules)) }
  async downloadServoMixer(): Promise<INavServoMixerRule[]> { return inav.inavDownloadServoMixer(this.queue) }
  async uploadServoMixer(rules: INavServoMixerRule[]): Promise<void> { return this.persistOrThrow(() => inav.inavUploadServoMixer(this.queue, rules)) }

  // ── Mode and adjustment ranges (Betaflight / iNav) ───────────
  private get isBetaflight(): boolean { return this.vehicleInfo?.firmwareType === 'betaflight' }
  async getModeBoxes(): Promise<MspModeBox[]> { return ranges.mspGetModeBoxes(this.queue) }
  async getModeRanges(): Promise<MspModeRange[]> { return ranges.mspGetModeRanges(this.queue, this.isBetaflight) }
  async setModeRanges(r: MspModeRange[]): Promise<CommandResult> {
    const result = await this.persist(() => ranges.mspSetModeRanges(this.queue, r, this.isBetaflight))
    // Flight-mode commands and the RC override switch modes through these
    // ranges and share this array; update it in place.
    if (result.success) this.modeRanges.splice(0, this.modeRanges.length, ...r.filter((m) => m.rangeStart < m.rangeEnd))
    return result
  }
  async getAdjustmentRanges(): Promise<MspAdjustmentRange[]> { return ranges.mspGetAdjustmentRanges(this.queue) }
  async setAdjustmentRanges(r: MspAdjustmentRange[]): Promise<CommandResult> { return this.persist(() => ranges.mspSetAdjustmentRanges(this.queue, r)) }

  async resetParametersToDefault() { return cmds.mspResetParametersToDefault() }
  async getLogList() { return cmds.mspGetLogList() }
  async downloadLog(id: number, onProgress?: LogDownloadProgressCallback) { return cmds.mspDownloadLog(id, onProgress) }
  async eraseAllLogs() { return cmds.mspEraseAllLogs() }
  cancelLogDownload(): void { /* no-op */ }
  // MSP has no MAVLink FTP transport. Reject explicitly rather than return
  // fabricated bytes so callers surface the real limitation.
  async downloadFileViaFtp(): Promise<Uint8Array> { throw new Error('MAVLink FTP is not available over MSP') }

  // ── Blackbox (onboard-flash logging) ─────────────────────────
  /** Read the onboard-flash summary (total/used bytes + ready state). */
  async getDataflashSummary(): Promise<{ totalSize: number; usedSize: number; ready: boolean }> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    const s = await getFlashSummary(this.queue)
    return { totalSize: s.totalSize, usedSize: s.usedSize, ready: s.ready }
  }

  /**
   * Download the raw blackbox log from onboard flash. Sizes the transfer from
   * the flash summary, then chunk-reads the used region via MSP_DATAFLASH_READ.
   * Returns the raw `.bbl` bytes with no decode (empty when the flash is not
   * ready or holds no data).
   */
  async downloadBlackbox(onProgress?: (p: BlackboxDownloadProgress) => void): Promise<Uint8Array> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    const summary = await getFlashSummary(this.queue)
    if (!summary.ready || summary.usedSize <= 0) return new Uint8Array(0)
    return downloadBlackboxLog(this.queue, 0, summary.usedSize, onProgress)
  }

  /** Erase all onboard-flash blackbox logs (polls until the flash reports empty). */
  async eraseDataflash(): Promise<void> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    await eraseBlackboxFlash(this.queue)
  }

  // ── Betaflight binary config (serial, OSD, LED strip, receiver) ──
  /** Which serial transport answered the last read: MSP2 32-bit mask or the legacy U16 one. */
  private _serialUsesV2: boolean | null = null

  async getSerialConfig(): Promise<MspSerialPort[]> {
    const { ports, extended } = await bf.bfGetSerialConfig(this.queue)
    this._serialUsesV2 = extended
    return ports
  }
  /** Whether the current serial config carries the 32-bit (MSP2) function mask. */
  serialConfigExtended(): boolean { return this._serialUsesV2 === true }
  async setSerialConfig(ports: MspSerialPort[]): Promise<CommandResult> { return this.persist(() => bf.bfSetSerialConfig(this.queue, ports, this._serialUsesV2 !== false)) }
  async sendDshotCommand(commandType: number, motorIndex: number, commands: number[]): Promise<CommandResult> { return bf.bfSendDshotCommand(this.queue, commandType, motorIndex, commands) }
  async getOsdConfig(): Promise<MspOsdConfig> { return bf.bfGetOsdConfig(this.queue) }
  async writeOsdLayout(items: Array<{ index: number; position: number }>, general?: MspOsdGeneralConfig): Promise<CommandResult> { return this.persist(() => bf.bfWriteOsdLayout(this.queue, items, general)) }
  async uploadOsdFont(glyphs: Uint8Array[], onProgress?: (done: number, total: number) => void): Promise<CommandResult> { return bf.bfUploadOsdFont(this.queue, glyphs, onProgress) }
  async getLedStripConfig(): Promise<number[]> { return bf.bfGetLedStripConfig(this.queue) }
  async setLedStripConfig(leds: number[]): Promise<CommandResult> { return this.persist(() => bf.bfSetLedStripConfig(this.queue, leds)) }
  async getLedColors(): Promise<HsvColor[]> { return bf.bfGetLedColors(this.queue) }
  async setLedColors(colors: HsvColor[]): Promise<CommandResult> { return this.persist(() => bf.bfSetLedColors(this.queue, colors)) }
  async getLedStripModeColors(): Promise<BfLedModeColor[]> { return bf.bfGetLedStripModeColors(this.queue) }
  async setLedStripModeColors(entries: BfLedModeColor[]): Promise<CommandResult> { return this.persist(() => bf.bfSetLedStripModeColors(this.queue, entries)) }

  /**
   * Subscribe to MSP DisplayPort (182) OSD frames the FC pushes. Fires only if
   * the FC is configured to output OSD over MSP DisplayPort on this connection.
   */
  onDisplayPort(cb: (op: DisplayPortOp) => void): () => void {
    if (!this.queue) return () => {}
    return this.queue.onUnsolicited((frame) => {
      if (frame.command === MSP.MSP_DISPLAYPORT) {
        const p = frame.payload
        cb(decodeMspDisplayPort(new DataView(p.buffer, p.byteOffset, p.byteLength)))
      }
    })
  }

  async getRxConfig(): Promise<BfRxConfig> { return bf.bfGetRxConfig(this.queue) }
  async setRxConfig(cfg: BfRxConfig): Promise<CommandResult> { return this.persist(() => bf.bfSetRxConfig(this.queue, cfg)) }
  async getRxMap(): Promise<number[]> { return bf.bfGetRxMap(this.queue) }
  async setRxMap(map: number[]): Promise<CommandResult> { return this.persist(() => bf.bfSetRxMap(this.queue, map)) }
  async getVtxPowerLevels(): Promise<MspVtxTablePowerLevel[]> { return bf.bfGetVtxPowerLevels(this.queue) }
}
