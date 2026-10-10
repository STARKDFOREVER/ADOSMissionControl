/**
 * Capabilities a protocol reports before a firmware handler is known.
 *
 * @module protocol/no-capabilities
 */

import type { ProtocolCapabilities } from './types'

/** Nothing supported: the vehicle's firmware is not identified yet. */
export const NO_CAPABILITIES: Readonly<ProtocolCapabilities> = {
  supportsArming: false, supportsFlightModes: false, supportsMissionUpload: false, supportsMissionDownload: false,
  supportsManualControl: false, supportsParameters: false, supportsCalibration: false, supportsSerialPassthrough: false,
  supportsMotorTest: false, supportsAutonomousNav: false, supportsGeoFence: false, supportsRally: false, supportsLogDownload: false,
  supportsOsd: false, supportsDisplayPort: false, supportsPidTuning: false, supportsPorts: false, supportsFailsafe: false,
  supportsPowerConfig: false, supportsReceiver: false, supportsFirmwareFlash: false, supportsCliShell: false,
  supportsMavlinkInspector: false, supportsGimbal: false, supportsCamera: false, supportsLed: false,
  supportsBattery2: false, supportsRangefinder: false, supportsOpticalFlow: false, supportsObstacleAvoidance: false,
  supportsDebugValues: false, supportsCanFrame: false, supportsAuxModes: false, supportsVtx: false, supportsBlackbox: false,
  supportsBetaflightConfig: false, supportsMspMotors: false, supportsGpsConfig: false, supportsEkfConfig: false, supportsStreamRates: false, supportsVtolConfig: false, supportsTecsConfig: false, supportsSubConfig: false, supportsPx4Tuning: false, supportsRateProfiles: false, supportsAdjustments: false,
  supportsMavlinkSigning: false,
  supportsMultiMission: false, supportsSafehome: false, supportsGeozone: false,
  supportsLogicConditions: false, supportsGlobalVariables: false, supportsProgrammingPid: false,
  supportsEzTune: false, supportsFwApproach: false, supportsCustomOsd: false,
  supportsMixerProfile: false, supportsBatteryProfile: false, supportsTempSensors: false,
  supportsServoMixer: false, supportsOutputMappingExt: false, supportsRateDynamics: false,
  supportsMcBraking: false, supportsSettings: false, supportsCliSettings: false,
  manualControlHz: 0, parameterCount: 0,
}
