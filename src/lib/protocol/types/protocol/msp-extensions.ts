/**
 * Optional DroneProtocol members implemented by the MSP firmwares (iNav and Betaflight).
 *
 * @module protocol/types/protocol/msp-extensions
 */

import type { CommandResult } from '../core';
import type { MAVLinkFrame } from '../../mavlink-parser';
import type { INavSafehome, INavGeozone, INavGeozoneVertex, INavActiveProfiles, INavBatteryConfig, INavMixer, INavServoConfig, INavMcBraking, INavRateDynamics, INavTimerOutputModeEntry, INavOutputMappingExt2Entry, INavTempSensorConfigEntry, INavCalibrationData, INavLogicCondition, INavGvarStatus, INavProgrammingPid, INavProgrammingPidStatus, INavEzTune, INavFwApproach, INavOsdAlarms, INavOsdPreferences, INavOsdLayoutsHeader, INavCustomOsdElement, INavCustomOsdElementsInfo, MotorMixerRule, INavServoMixerRule } from '../inav';
import type { MspSerialPort } from '../../msp/decoders/config/serial';
import type { MspOsdConfig, MspOsdGeneralConfig } from '../../msp/decoders/config/osd';
import type { BfRxConfig } from '../../msp/decoders/config/rx';
import type { DisplayPortOp } from '../../msp/decoders/config/displayport';
import type { MspModeBox, MspModeRange, MspAdjustmentRange } from '../../msp/msp-decoders-status';
import type { HsvColor, BfLedModeColor, MspVtxTablePowerLevel } from '../betaflight';
import type { SettingsCapability, CliSettingsCapability } from '../settings';

/** Optional MSP firmware members of {@link DroneProtocol}. */
export interface DroneProtocolMspExtensions {
  // ── iNav Navigation Features ──────────────────────────────
  uploadSafehomes?(safehomes: INavSafehome[]): Promise<CommandResult>;
  downloadSafehomes?(): Promise<INavSafehome[]>;
  uploadGeozones?(zones: INavGeozone[], vertices: INavGeozoneVertex[]): Promise<CommandResult>;
  downloadGeozones?(): Promise<{ zones: INavGeozone[]; vertices: INavGeozoneVertex[] }>;

  // ── iNav Configuration ────────────────────────────────────
  getBatteryConfig?(): Promise<INavBatteryConfig>;
  setBatteryConfig?(cfg: INavBatteryConfig): Promise<CommandResult>;
  selectBatteryProfile?(idx: number): Promise<CommandResult>;
  /** The control, battery and mixer profiles the FC is flying (MSP2_INAV_STATUS). */
  getActiveProfiles?(): Promise<INavActiveProfiles>;
  /** Switch the control profile (MSP_SELECT_SETTING); the FC refuses while armed. */
  selectControlProfile?(idx: number): Promise<CommandResult>;
  getMixerConfig?(): Promise<INavMixer>;
  selectMixerProfile?(idx: number): Promise<CommandResult>;
  getOutputMapping?(): Promise<INavOutputMappingExt2Entry[]>;
  getTimerOutputModes?(): Promise<INavTimerOutputModeEntry[]>;
  setTimerOutputMode?(entries: INavTimerOutputModeEntry[]): Promise<CommandResult>;
  getServoConfigs?(): Promise<INavServoConfig[]>;
  /** Write every servo's config (index = array position), then save to EEPROM. */
  setServoConfigs?(cfgs: INavServoConfig[]): Promise<CommandResult>;
  getTempSensorConfigs?(): Promise<INavTempSensorConfigEntry[]>;
  /** Live temperature per sensor slot in tenths of a degree C; null = no valid reading (iNav). */
  getTemperatures?(): Promise<(number | null)[]>;
  /** Accelerometer six-point progress and compass offsets (iNav MSP_CALIBRATION_DATA). */
  getCalibrationData?(): Promise<INavCalibrationData>;
  getMcBraking?(): Promise<INavMcBraking>;
  setMcBraking?(b: INavMcBraking): Promise<CommandResult>;
  getRateDynamics?(): Promise<INavRateDynamics>;
  setRateDynamics?(r: INavRateDynamics): Promise<CommandResult>;
  getEzTune?(): Promise<INavEzTune>;
  setEzTune?(cfg: INavEzTune): Promise<CommandResult>;
  getFwApproach?(): Promise<INavFwApproach[]>;
  setFwApproach?(a: INavFwApproach): Promise<CommandResult>;
  getOsdLayoutsHeader?(): Promise<INavOsdLayoutsHeader>;
  getOsdAlarms?(): Promise<INavOsdAlarms>;
  setOsdAlarms?(a: INavOsdAlarms): Promise<CommandResult>;
  getOsdPreferences?(): Promise<INavOsdPreferences>;
  setOsdPreferences?(p: INavOsdPreferences): Promise<CommandResult>;
  getCustomOsdElements?(): Promise<{ info: INavCustomOsdElementsInfo; elements: INavCustomOsdElement[] }>;
  setCustomOsdElement?(el: INavCustomOsdElement): Promise<CommandResult>;

  // ── iNav Name-Based Settings (optional) ───────────────────
  /**
   * Name-indexed settings surface. Defined only on firmwares that expose
   * named settings (iNav); undefined on MAVLink firmwares.
   */
  settings?: SettingsCapability;

  /**
   * Text-CLI settings surface. Defined only on firmwares whose full settings
   * are reachable solely over the CLI (Betaflight); undefined elsewhere.
   */
  cliSettings?: CliSettingsCapability;

  /**
   * Subscribe to every inbound MAVLink frame after the link's parser has
   * reassembled it across chunks, checked its CRC and stripped any signature.
   * Defined only on MAVLink links; undefined on MSP.
   */
  onMavlinkFrame?(callback: (frame: MAVLinkFrame) => void): () => void;

  // ── Betaflight binary config (MSP) ────────────────────────
  /** Read the per-UART serial-port configuration (Betaflight). */
  getSerialConfig?(): Promise<MspSerialPort[]>;
  /** Write the per-UART serial-port configuration (Betaflight). */
  setSerialConfig?(ports: MspSerialPort[]): Promise<CommandResult>;
  /** Whether the last serial read carried the 32-bit MSP2 function mask (bits > 15). */
  serialConfigExtended?(): boolean;
  /** Send a DShot special command to an ESC (beacon / spin direction / 3D / save). Disarmed-only (Betaflight). */
  sendDshotCommand?(commandType: number, motorIndex: number, commands: number[]): Promise<CommandResult>;
  /** Test a single actuator output (PX4). functionCode = ACTUATOR_OUTPUT_FUNCTION, value -1..1 (NaN=stop), timeoutS auto-restores. Disarmed-only. */
  actuatorTest?(functionCode: number, value: number, timeoutS: number): Promise<CommandResult>;
  /** Read the OSD config: video system, alarms, per-element positions (Betaflight). */
  getOsdConfig?(): Promise<MspOsdConfig>;
  /** Write the OSD layout: optional general settings, then each element position (Betaflight). */
  writeOsdLayout?(items: Array<{ index: number; position: number }>, general?: MspOsdGeneralConfig): Promise<CommandResult>;
  /** Upload a MAX7456 character font, one glyph per MSP_OSD_CHAR_WRITE (Betaflight). */
  uploadOsdFont?(glyphs: Uint8Array[], onProgress?: (done: number, total: number) => void): Promise<CommandResult>;
  /** Read the onboard blackbox flash summary: total and used bytes, ready state (Betaflight). */
  getDataflashSummary?(): Promise<{ totalSize: number; usedSize: number; ready: boolean }>;
  /** Download the logged part of the onboard blackbox flash; empty when nothing is logged (Betaflight). */
  downloadBlackbox?(onProgress?: (p: { percentComplete: number }) => void): Promise<Uint8Array>;
  /** Erase the onboard blackbox flash, resolving once the FC reports it empty (Betaflight). */
  eraseDataflash?(): Promise<void>;
  /** Read the per-LED packed strip config (Betaflight). */
  getLedStripConfig?(): Promise<number[]>;
  /** Write the per-LED packed strip config, one MSP write per LED (Betaflight). */
  setLedStripConfig?(leds: number[]): Promise<CommandResult>;
  /** Read the 16-entry configurable HSV colour palette (Betaflight). */
  getLedColors?(): Promise<HsvColor[]>;
  /** Write the 16-entry HSV colour palette (Betaflight). */
  setLedColors?(colors: HsvColor[]): Promise<CommandResult>;
  /** Read the mode/special/aux colour assignments (Betaflight). */
  getLedStripModeColors?(): Promise<BfLedModeColor[]>;
  /** Set mode colours by (mode, function), then save to EEPROM (Betaflight). */
  setLedStripModeColors?(entries: BfLedModeColor[]): Promise<CommandResult>;
  /** Subscribe to pushed MSP DisplayPort OSD frames (Betaflight / iNav). */
  onDisplayPort?(cb: (op: DisplayPortOp) => void): () => void;
  /** Read the receiver config: provider, stick range, deadband (Betaflight). */
  getRxConfig?(): Promise<BfRxConfig>;
  /** Write the receiver config (Betaflight). */
  setRxConfig?(cfg: BfRxConfig): Promise<CommandResult>;
  /** Read the RC channel map (Betaflight). */
  getRxMap?(): Promise<number[]>;
  /** Write the RC channel map (Betaflight). */
  setRxMap?(map: number[]): Promise<CommandResult>;
  /** Read the VTX table power levels; `BF_VTX_POWER` indexes them from 1. Empty without a VTX table (Betaflight). */
  getVtxPowerLevels?(): Promise<MspVtxTablePowerLevel[]>;

  // ── iNav Programming Framework ────────────────────────────
  downloadLogicConditions?(): Promise<INavLogicCondition[]>;
  /** Write every logic condition (index = array position), then save to EEPROM. */
  uploadLogicConditions?(rules: INavLogicCondition[]): Promise<CommandResult>;
  /** Live value of every logic condition, by slot. */
  downloadLogicConditionsStatus?(): Promise<number[]>;
  downloadGvarStatus?(): Promise<INavGvarStatus>;
  /** Set one global variable's live runtime value (iNav). */
  setGvar?(index: number, value: number): Promise<CommandResult>;
  downloadProgrammingPids?(): Promise<INavProgrammingPid[]>;
  /** Write every programming PID (index = array position), then save to EEPROM. */
  uploadProgrammingPids?(rules: INavProgrammingPid[]): Promise<CommandResult>;
  downloadProgrammingPidStatus?(): Promise<INavProgrammingPidStatus[]>;
  downloadMotorMixer?(): Promise<MotorMixerRule[]>;
  uploadMotorMixer?(rules: MotorMixerRule[]): Promise<void>;
  downloadServoMixer?(): Promise<INavServoMixerRule[]>;
  uploadServoMixer?(rules: INavServoMixerRule[]): Promise<void>;

  // ── Mode and adjustment ranges (Betaflight / iNav) ─────────
  /** The modes the FC offers, by permanent box id (MSP_BOXNAMES + MSP_BOXIDS). */
  getModeBoxes?(): Promise<MspModeBox[]>;
  /** Every mode-range slot in slot order, empty ones included (start >= end). */
  getModeRanges?(): Promise<MspModeRange[]>;
  /**
   * Write `ranges` to slots 0..n-1, clear the remaining slots, then save to
   * EEPROM. Fails when any slot write or the save fails.
   */
  setModeRanges?(ranges: MspModeRange[]): Promise<CommandResult>;
  /** Every adjustment-range slot in slot order, empty ones included. */
  getAdjustmentRanges?(): Promise<MspAdjustmentRange[]>;
  /** Same slot semantics as `setModeRanges`, for adjustment ranges. */
  setAdjustmentRanges?(ranges: MspAdjustmentRange[]): Promise<CommandResult>;

}
