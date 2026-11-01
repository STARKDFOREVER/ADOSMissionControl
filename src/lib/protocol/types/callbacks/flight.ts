/**
 * Flight, link and status telemetry callbacks.
 *
 * Shapes reuse the store telemetry interfaces where they match, so
 * protocol → store bridging is a plain assignment.
 *
 * @module protocol/types/callbacks/flight
 */

import type { UnifiedFlightMode } from '../enums';
import type { VehicleInfo, ParameterValue } from '../core';
import type { AttitudeData, BatteryData, GpsData, PositionData, RadioData, RcData, SysStatusData, VfrData } from '../../../types/telemetry';

export type AttitudeCallback = (data: AttitudeData) => void;

export type PositionCallback = (data: PositionData) => void;

export type BatteryCallback = (data: BatteryData & {
  /**
   * Battery instance (BATTERY_STATUS.id). 0 is the primary pack; further
   * monitors (a second pack, an avionics rail) report their own ids.
   */
  id: number;
}) => void;

export type GpsCallback = (data: GpsData) => void;

export type VfrCallback = (data: VfrData) => void;

export type RcCallback = (data: RcData) => void;

export type StatusTextCallback = (data: {
  severity: number;
  text: string;
}) => void;

/** MAVLink EVENT (msg 410) — the PX4 structured-events successor to STATUSTEXT.
 * `id` = (componentId << 24) | subId, keying the events metadata; `logLevels`
 * is a 4-bit MSB internal + 4-bit LSB external level; `arguments` are packed
 * bytes decoded per the event's metadata argument types. */
export type EventCallback = (data: {
  id: number;
  eventTimeBootMs: number;
  sequence: number;
  destinationComponent: number;
  destinationSystem: number;
  logLevels: number;
  arguments: Uint8Array;
}) => void;

export type HeartbeatCallback = (data: {
  armed: boolean;
  mode: UnifiedFlightMode;
  systemStatus: number;
  vehicleInfo: VehicleInfo;
}) => void;

export type ParameterCallback = (data: ParameterValue) => void;

export type SerialDataCallback = (data: { device: number; data: Uint8Array }) => void;

export type SysStatusCallback = (data: SysStatusData) => void;

export type RadioCallback = (data: RadioData) => void;

export type MissionProgressCallback = (data: {
  currentSeq: number;
  reachedSeq?: number;
}) => void;

export type ACFlyK9MissionCurrentCallback = (data: {
  timestamp: number;
  seq: number;
  resumeSeq: number;
  /** Channel 2 value in the documented range 0-10000; INT16_MAX is invalid. */
  flag?: number;
  heading: number;
  vectorX: number;
  vectorY: number;
  vectorZ: number;
  distance: number;
  triggerInterval: number;
  speed: number;
  radius: number;
}) => void;
