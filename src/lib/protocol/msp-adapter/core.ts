/**
 * MSP adapter core: connection, commands, parameters and telemetry.
 * @module protocol/msp-adapter/core
 */

import type { Transport, VehicleInfo, CommandResult, FirmwareHandler, ProtocolCapabilities, UnifiedFlightMode, MissionItem, SettingsCapability, CliSettingsCapability, SerialDataCallback } from '../types'
import { MspParser } from '../msp/msp-parser'
import { MspSerialQueue } from '../msp/msp-serial-queue'
import { MspTelemetryPoller } from '../msp/msp-telemetry-poller'
import { MspLinkMonitor } from '../msp/msp-link-monitor'
import { MSP } from '../msp/msp-constants'
import { MspRcOverride } from '../msp/msp-rc-override'
import type { ModeRange } from '../msp/msp-mode-map'
import { betaflightHandler } from '../firmware/betaflight'
import { inavHandler } from '../firmware/inav'
import { createCallbackStore, bindCallbackMethods } from '../mavlink-adapter-callbacks'
import { createMspTelemetryState, dispatchMspTelemetry } from '../msp-adapter-telemetry'
import * as cmds from '../msp-adapter-commands'
import * as prm from '../msp-adapter-params'
import * as inav from '../msp-adapter-inav'
import { SettingsClient } from '../msp/settings'
import { MspCliSession, BETAFLIGHT_CLI, INAV_CLI } from '../msp/cli-session'
import { makeCliSettingsCapability } from '../msp/bf-cli-settings'
import { mspIdentify } from './handshake'
import { emptyCapabilities } from './capabilities'
import { makeSettingsCapability } from './settings-capability'

/**
 * Connection, flight commands, parameters and telemetry for an MSP link.
 * {@link MSPAdapter} adds the firmware configuration surfaces on top.
 */
export class MspAdapterCore {
  readonly protocolName = 'msp'

  private parser: MspParser = new MspParser()
  protected queue: MspSerialQueue | null = null
  private poller: MspTelemetryPoller | null = null
  private transport: Transport | null = null
  private firmwareHandler: FirmwareHandler | null = null
  protected vehicleInfo: VehicleInfo | null = null
  private _connected = false
  private boxIds: number[] = []
  protected modeRanges: ModeRange[] = []
  /** True only when the FC's receiver provider is MSP; RC override is inert otherwise. */
  private rxMspEnabled = false
  private rcOverride: MspRcOverride | null = null
  private paramCache: Map<number, Uint8Array> = new Map()
  private paramNameCache: string[] = []
  private settingsClient: SettingsClient | null = null
  private settingsCapability: SettingsCapability | null = null
  private cli: MspCliSession | null = null
  private cliSettingsCapability: CliSettingsCapability | null = null
  private cbs = createCallbackStore()
  private cbm = bindCallbackMethods(this.cbs)
  /**
   * Last armed flag decoded from MSP_STATUS_EX. MSP has no separate arm query,
   * so this is the only arm state the link has, and a safety gate that needs
   * it (motor test) reads it from here rather than guessing.
   */
  private lastArmed = false
  private dataHandler: ((data: Uint8Array) => void) | null = null
  private closeHandler: (() => void) | null = null
  /** Reports link loss and recovery; MSP has no heartbeat of its own. */
  private linkMonitor: MspLinkMonitor | null = null

  get isConnected(): boolean { return this._connected }

  // ── Context helpers ─────────────────────────────────────────
  protected get cmdCtx(): cmds.MspCommandContext { return { queue: this.queue, modeRanges: this.modeRanges, rc: this.rcOverride, firmwareType: this.vehicleInfo?.firmwareType, isArmed: () => this.lastArmed } }
  private get prmCtx(): prm.MspParamContext { return { queue: this.queue, paramCache: this.paramCache, paramNameCache: this.paramNameCache, parameterCallbacks: this.cbs.parameterCallbacks, settingsClient: this.settingsClient, isInav: this.vehicleInfo?.firmwareType === 'inav' } }

  // ── Connection ──────────────────────────────────────────────
  async connect(transport: Transport): Promise<VehicleInfo> {
    this.transport = transport
    // While a CLI session is active the FC speaks only plain-ASCII CLI (not
    // MSP), so route inbound bytes to the CLI session instead of the MSP
    // parser, which would drop them.
    this.dataHandler = (data: Uint8Array) => {
      if (this.cli?.isActive) this.cli.feed(data)
      else this.parser.feed(data)
    }
    this.closeHandler = () => this.handleDisconnect()
    transport.on('data', this.dataHandler)
    transport.on('close', this.closeHandler as (data: void) => void)

    const queue = new MspSerialQueue(transport.send.bind(transport), this.parser, 1000, 2)
    this.queue = queue
    this.settingsClient = new SettingsClient(queue)
    this.settingsCapability = makeSettingsCapability(this.settingsClient)

    // A handshake that fails part-way tears down what was attached above, so a
    // retry on the same transport does not feed its bytes to a second parser.
    try {
      return await this.handshake(queue)
    } catch (err) {
      this.handleDisconnect()
      throw err
    }
  }

  private async handshake(queue: MspSerialQueue): Promise<VehicleInfo> {
    const id = await mspIdentify(queue)
    const { apiVersionMajor, apiVersionMinor, variantStr, firmwareVersionString, boardInfo } = id
    this.boxIds = id.boxIds
    this.modeRanges = id.modeRanges
    this.rxMspEnabled = id.rxMspEnabled

    this.rcOverride = new MspRcOverride({
      send: (payload) => queue.sendNoReply(MSP.MSP_SET_RAW_RC, payload),
      modeRanges: this.modeRanges,
      rxMspEnabled: this.rxMspEnabled,
    })

    const isBetaflight = variantStr.trim() === 'BTFL'
    const isInav = variantStr.trim() === 'INAV'
    this.firmwareHandler = isInav ? inavHandler : betaflightHandler
    if (isBetaflight || isInav) {
      // A motor test cut off by a dropped link keeps spinning until the FC
      // reboots; clear any such leftover before anything else is commanded.
      cmds.mspIdleMotorOutputs(queue)
      // The CLI session pauses MSP polling while active and drives the
      // raw-byte tap set up above. Betaflight settings live only behind it.
      this.cli = new MspCliSession({
        send: (bytes) => this.transport?.send(bytes),
        setActive: (active) => { if (active) this.poller?.stop(); else this.poller?.start() },
      }, isInav ? INAV_CLI : BETAFLIGHT_CLI)
      if (isBetaflight) this.cliSettingsCapability = makeCliSettingsCapability(this.cli)
    }

    const info: VehicleInfo = {
      firmwareType: isBetaflight ? 'betaflight' : isInav ? 'inav' : 'unknown',
      vehicleClass: 'copter', firmwareVersionString,
      systemId: 0, componentId: 0, autopilotType: 0, vehicleType: 0,
      gyroSampleRateHz: boardInfo.gyroSampleRateHz,
      boardTargetName: boardInfo.boardName || boardInfo.targetName,
      mspApiVersion: { major: apiVersionMajor, minor: apiVersionMinor },
    }
    this.vehicleInfo = info

    // Retain the armed flag as it goes past: the motor-test gate needs it and
    // MSP offers no way to ask for it on demand.
    this.cbs.heartbeatCallbacks.push((hb) => { this.lastArmed = hb.armed })
    // Fresh per connection: an RSSI heard on a previous link is not this one's.
    const telemetryState = createMspTelemetryState()
    this.poller = new MspTelemetryPoller(queue, info.firmwareType, (command, payload) =>
      dispatchMspTelemetry(command, payload, this.cbs, this.vehicleInfo, this.boxIds, telemetryState))
    this.poller.start()
    this.linkMonitor = new MspLinkMonitor({
      queue,
      parser: this.parser,
      paused: () => this.cli?.isActive === true,
      onLost: () => { for (const cb of this.cbs.linkLostCallbacks) cb() },
      onRestored: () => { for (const cb of this.cbs.linkRestoredCallbacks) cb() },
    })
    this.linkMonitor.start()
    this._connected = true
    return info
  }

  async disconnect(): Promise<void> {
    this.handleDisconnect()
    if (this.transport?.isConnected) await this.transport.disconnect()
  }

  /** Fires once when the link closes or the adapter is disconnected. */
  onDisconnect(cb: () => void): () => void {
    this.disconnectListeners.push(cb)
    return () => { this.disconnectListeners = this.disconnectListeners.filter((l) => l !== cb) }
  }
  private disconnectListeners: Array<() => void> = []

  private handleDisconnect(): void {
    if (!this._connected && !this.poller && !this.queue) return
    const wasConnected = this._connected
    this._connected = false
    if (this.rcOverride) { this.rcOverride.destroy(); this.rcOverride = null }
    this.rxMspEnabled = false
    if (this.poller) { this.poller.stop(); this.poller = null }
    if (this.linkMonitor) { this.linkMonitor.stop(); this.linkMonitor = null }
    if (this.queue) { cmds.mspCancelMotorTest(this.queue); this.queue.destroy(); this.queue = null }
    this.parser.reset(); this.paramCache.clear(); this.paramNameCache = []; this.lastArmed = false; this.settingsClient = null; this.settingsCapability = null; this.cli = null; this.cliSettingsCapability = null
    if (this.transport && this.dataHandler) {
      this.transport.off('data', this.dataHandler)
      this.transport.off('close', this.closeHandler as (data: void) => void)
    }
    this.transport = null
    if (wasConnected) for (const cb of [...this.disconnectListeners]) cb()
  }

  // ── Commands ────────────────────────────────────────────────
  async arm() { return cmds.mspArm(this.cmdCtx) }
  async disarm() { return cmds.mspDisarm(this.cmdCtx) }
  async setFlightMode(m: UnifiedFlightMode) { return cmds.mspSetFlightMode(this.cmdCtx, m) }
  sendManualControl(r: number, p: number, t: number, y: number, _b: number) { cmds.mspSendManualControl(this.cmdCtx, r, p, t, y) }
  async motorTest(m: number, t: number, d: number) { return cmds.mspMotorTest(this.cmdCtx, m, t, d) }
  async setMotorTestOutputs(t: readonly number[], d: number) { return cmds.mspSetMotorOutputs(this.cmdCtx, t, d) }
  async reboot() { return cmds.mspReboot(this.cmdCtx) }
  async rebootToBootloader() {
    // iNav ignores MSP_SET_REBOOT's bootloader type byte and boots normal
    // firmware; its CLI `dfu` command is what enters the ROM bootloader.
    if (this.vehicleInfo?.firmwareType === 'inav' && this.cli) {
      if (this.lastArmed) return { success: false, resultCode: -1, message: 'Bootloader reboot refused: vehicle is armed' }
      await this.cli.enter()
      this.cli.sendInteractive('dfu')
      return { success: true, resultCode: 0, message: 'Rebooting to bootloader' }
    }
    return cmds.mspRebootToBootloader(this.cmdCtx)
  }
  async startCalibration(type: 'accel'|'gyro'|'compass'|'level'|'airspeed'|'baro'|'rc'|'esc'|'compassmot') { return cmds.mspStartCalibration(this.cmdCtx, type) }
  async commitParamsToFlash() { return cmds.mspCommitParamsToFlash(this.cmdCtx) }
  async killSwitch() { return cmds.mspKillSwitch(this.cmdCtx) }
  async doPreArmCheck() { return cmds.mspDoPreArmCheck(this.cmdCtx) }
  async returnToLaunch() { return cmds.mspReturnToLaunch(this.cmdCtx) }
  async land() { return cmds.mspLand(this.cmdCtx) }
  async takeoff(alt: number) { return cmds.mspTakeoff(this.cmdCtx, alt) }
  async guidedGoto(lat: number, lon: number, alt: number) { return cmds.mspGuidedGoto(this.cmdCtx, lat, lon, alt) }
  async pauseMission() { return cmds.mspPauseMission(this.cmdCtx) }
  async resumeMission() { return cmds.mspResumeMission(this.cmdCtx) }
  async clearMission() { return cmds.mspClearMission() }
  async setHome(_uc: boolean) { return cmds.mspSetHome() }
  async changeSpeed(_st: number, _sp: number) { return cmds.mspChangeSpeed() }
  async setYaw(_a: number, _s: number, _d: number, _r: boolean) { return cmds.mspSetYaw() }
  async setGeoFenceEnabled(_e: boolean) { return cmds.mspSetGeoFenceEnabled() }
  async setServo(_n: number, _p: number) { return cmds.mspSetServo() }
  async cameraTrigger() { return cmds.mspCameraTrigger() }
  async setGimbalAngle(_p: number, _r: number, _y: number) { return cmds.mspSetGimbalAngle() }
  async uploadMission(items: MissionItem[]) {
    if (this.vehicleInfo?.firmwareType === 'inav') {
      return inav.inavUploadMission(this.queue, items)
    }
    return cmds.mspUploadMission()
  }
  async downloadMission(): Promise<MissionItem[]> {
    if (this.vehicleInfo?.firmwareType === 'inav') {
      return inav.inavDownloadMission(this.queue)
    }
    return cmds.mspDownloadMission()
  }
  async setCurrentMissionItem(_seq: number) { return cmds.mspSetCurrentMissionItem() }

  // MSP firmwares do not implement the MAVLink EKF source-set command. Resolve
  // with a typed rejection so callers can render the right UX.
  async setEkfSourceSet(sourceSet: 1 | 2 | 3): Promise<{ ok: true } | { ok: false; reason: 'px4-not-supported' | 'no-ack' | 'rejected' }> {
    if (sourceSet !== 1 && sourceSet !== 2 && sourceSet !== 3) {
      throw new TypeError(`setEkfSourceSet: sourceSet must be 1, 2, or 3 (received ${String(sourceSet)})`)
    }
    return { ok: false, reason: 'rejected' }
  }


  // ── Parameters ──────────────────────────────────────────────
  async getAllParameters() { const c = this.prmCtx; const r = await prm.mspGetAllParameters(c); this.paramNameCache = c.paramNameCache; return r }
  async getParameter(name: string) { return prm.mspGetParameter(this.prmCtx, name) }
  async setParameter(name: string, value: number) { return prm.mspSetParameter(this.prmCtx, name, value) }
  getCachedParameterNames(): string[] { return this.paramNameCache }

  // ── iNav name-based settings ────────────────────────────────
  /**
   * Name-indexed settings surface (`DroneProtocol.settings`), backed by the
   * typed `SettingsClient`. Undefined until connected to an MSP firmware.
   */
  get settings(): SettingsCapability | undefined { return this.settingsCapability ?? undefined }

  /**
   * Text-CLI settings surface (`DroneProtocol.cliSettings`), backed by a
   * Betaflight CLI session. Undefined until connected to a Betaflight FC.
   */
  get cliSettings(): CliSettingsCapability | undefined { return this.cliSettingsCapability ?? undefined }

  // ── Serial Passthrough ──────────────────────────────────────
  sendSerialData(text: string): void {
    // The CLI is plain ASCII the MSP parser drops, so drive it through the
    // interactive CLI session. It enters the CLI, appends the line
    // terminator, and turns a typed exit or save into the firmware's form.
    this.cli?.sendInteractive(text)
  }

  // ── Telemetry Subscriptions ─────────────────────────────────
  onSerialData = (cb: SerialDataCallback): (() => void) => {
    this.cbs.serialDataCallbacks.push(cb)
    const cli = this.cli
    cli?.attachInteractive((text) => cb({ device: 0, data: new TextEncoder().encode(text) }))
    return () => { cli?.detachInteractive(); this.cbs.serialDataCallbacks = this.cbs.serialDataCallbacks.filter(c => c !== cb) }
  }
  onAttitude = this.cbm.onAttitude; onPosition = this.cbm.onPosition; onBattery = this.cbm.onBattery
  onGps = this.cbm.onGps; onVfr = this.cbm.onVfr; onRc = this.cbm.onRc
  onStatusText = this.cbm.onStatusText; onEvent = this.cbm.onEvent; onHeartbeat = this.cbm.onHeartbeat
  onParameter = this.cbm.onParameter
  onSysStatus = this.cbm.onSysStatus; onRadio = this.cbm.onRadio
  onMissionProgress = this.cbm.onMissionProgress; onEkf = this.cbm.onEkf
  onVibration = this.cbm.onVibration; onServoOutput = this.cbm.onServoOutput
  onWind = this.cbm.onWind; onTerrain = this.cbm.onTerrain
  onMagCalProgress = this.cbm.onMagCalProgress; onMagCalReport = this.cbm.onMagCalReport
  onAccelCalPos = this.cbm.onAccelCalPos; onHomePosition = this.cbm.onHomePosition
  onAutopilotVersion = this.cbm.onAutopilotVersion; onPowerStatus = this.cbm.onPowerStatus
  onDistanceSensor = this.cbm.onDistanceSensor; onFenceStatus = this.cbm.onFenceStatus
  onNavController = this.cbm.onNavController; onScaledImu = this.cbm.onScaledImu
  onScaledPressure = this.cbm.onScaledPressure; onEstimatorStatus = this.cbm.onEstimatorStatus
  onCameraTrigger = this.cbm.onCameraTrigger; onLinkLost = this.cbm.onLinkLost
  onLinkRestored = this.cbm.onLinkRestored; onLocalPosition = this.cbm.onLocalPosition
  onDebug = this.cbm.onDebug; onGimbalAttitude = this.cbm.onGimbalAttitude
  onObstacleDistance = this.cbm.onObstacleDistance; onCameraImageCaptured = this.cbm.onCameraImageCaptured
  onExtendedSysState = this.cbm.onExtendedSysState; onFencePoint = this.cbm.onFencePoint
  onSystemTime = this.cbm.onSystemTime; onRawImu = this.cbm.onRawImu
  onRcChannelsRaw = this.cbm.onRcChannelsRaw; onRcChannelsOverride = this.cbm.onRcChannelsOverride
  onMissionItem = this.cbm.onMissionItem; onAltitude = this.cbm.onAltitude
  onWindCov = this.cbm.onWindCov; onAisVessel = this.cbm.onAisVessel
  onGimbalManagerInfo = this.cbm.onGimbalManagerInfo; onGimbalManagerStatus = this.cbm.onGimbalManagerStatus

  // ── Info ────────────────────────────────────────────────────
  getVehicleInfo(): VehicleInfo | null { return this.vehicleInfo }

  /**
   * Why the RC override is inert, or null when it will reach `rcData[]`.
   *
   * The override object computes this once at connect from the feature word
   * and the configured mode ranges. Before connect there is no override, and
   * a link with no override sends nothing.
   */
  getManualControlBlockedReason(): string | null {
    if (!this.rcOverride) return this._connected ? 'the RC override is not set up on this link' : null
    return this.rcOverride.blockedReason
  }

  getCapabilities(): ProtocolCapabilities {
    const base = this.firmwareHandler?.getCapabilities() ?? emptyCapabilities()
    // The firmware handler declares the rate its flight controller expects; it
    // cannot know whether this particular flight controller is configured to
    // read the frames at all. When the override is blocked or absent nothing
    // is transmitted, and reporting a rate would describe traffic that does
    // not exist.
    const sends = this.rcOverride !== null && this.rcOverride.blockedReason === null
    return sends ? base : { ...base, manualControlHz: 0 }
  }

  getFirmwareHandler(): FirmwareHandler | null { return this.firmwareHandler }

  // MSP doesn't support these methods
  async sendCommand(_id: number, _p: number[]): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  confirmAccelCalPos(_pos: number): void { /* no-op */ }
  async acceptCompassCal(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async cancelCompassCal(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async cancelCalibration(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async startGnssMagCal(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async enableFence(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async doLandStart(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async controlVideo(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async setRelay(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async startRxPair(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async requestMessage(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async setMessageInterval(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async setGimbalMode(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  getCommandQueueSnapshot() { return { pendingCount: 0, entries: [] } }
}
