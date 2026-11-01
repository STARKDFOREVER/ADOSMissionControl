/**
 * ACFly K9 custom MAVLink message decoders.
 *
 * @module protocol/messages/acfly-k9
 */

export interface ACFlyK9BatteryStatusMsg {
  voltage: number;
  capacity: number;
  sequenceNum: number;
  faultBitmask: number;
  temperature: number;
  cycleCount: number;
  current: number;
  id: number;
  health: number;
  remainingPercentage: number;
  cellCount: number;
  cellVoltages: number[];
}

export interface ACFlyK9EscTelemetryMsg {
  messageType: 80;
  targetNetwork: number;
  targetSystem: number;
  targetComponent: 80;
  motorId: number;
  errorFlags: number;
  rpm: number;
  voltage: number;
  current: number;
  escTemperature: number;
  motorTemperature: number;
}

export interface ACFlyK9PayloadTelemetryMsg {
  messageType: 81;
  targetNetwork: number;
  targetSystem: number;
  targetComponent: 81;
  moduleId: number;
  statusFlags: number;
  hookLocked: boolean;
  weightExceeded: boolean;
  winchAtUpperLimit: boolean;
  winchAtLowerLimit: boolean;
  fuseActive: boolean;
  cargoWeightKg: number;
  totalWeightKg: number;
  ropeLengthCm: number;
  speedCmPerSecond: number;
  fuseTemperature: number;
  maximumLoadKg: number;
  maximumRopeLengthCm: number;
  maximumUpSpeedCmPerSecond: number;
  maximumDownSpeedCmPerSecond: number;
}

export type ACFlyK9ComponentExtension43Msg =
  | ACFlyK9EscTelemetryMsg
  | ACFlyK9PayloadTelemetryMsg;

export interface ACFlyK9MissionCurrentMsg {
  seq: number;
  resumeSeq: number;
  flag: number;
  heading: number;
  vectorX: number;
  vectorY: number;
  vectorZ: number;
  distance: number;
  triggerInterval: number;
  speed: number;
  radius: number;
}

/** Decode the ACFly K9 BATTERY_STATUS_ACFLY message (ID 602, 72 bytes). */
export function decodeACFlyK9BatteryStatus(dv: DataView): ACFlyK9BatteryStatusMsg {
  const cellVoltages: number[] = [];
  for (let i = 0; i < 48; i++) {
    cellVoltages.push(dv.getUint8(24 + i));
  }

  return {
    voltage: dv.getUint32(0, true),
    capacity: dv.getUint32(4, true),
    sequenceNum: dv.getUint32(8, true),
    faultBitmask: dv.getUint16(12, true),
    temperature: dv.getInt16(14, true),
    cycleCount: dv.getUint16(16, true),
    current: dv.getInt16(18, true),
    id: dv.getUint8(20),
    health: dv.getUint8(21),
    remainingPercentage: dv.getUint8(22),
    cellCount: dv.getUint8(23),
    cellVoltages,
  };
}

/** Decode the ACFly K9 COMPONENT_EXTENSION43 message (ID 500). */
export function decodeACFlyK9ComponentExtension43(
  dv: DataView,
): ACFlyK9ComponentExtension43Msg | null {
  const messageType = dv.getUint16(0, true);
  const targetNetwork = dv.getUint8(2);
  const targetSystem = dv.getUint8(3);
  const targetComponent = dv.getUint8(4);
  const payload = 5;

  if (messageType === 80 && targetComponent === 80) {
    return {
      messageType,
      targetNetwork,
      targetSystem,
      targetComponent,
      motorId: dv.getUint8(payload),
      errorFlags: dv.getUint16(payload + 1, true),
      rpm: dv.getUint32(payload + 3, true),
      voltage: dv.getFloat32(payload + 7, true),
      current: dv.getFloat32(payload + 11, true),
      escTemperature: dv.getInt16(payload + 15, true),
      motorTemperature: dv.getInt16(payload + 17, true),
    };
  }

  if (messageType === 81 && targetComponent === 81) {
    const statusFlags = dv.getUint32(payload + 1, true);
    return {
      messageType,
      targetNetwork,
      targetSystem,
      targetComponent,
      moduleId: dv.getUint8(payload),
      statusFlags,
      hookLocked: (statusFlags & (1 << 0)) !== 0,
      weightExceeded: (statusFlags & (1 << 1)) !== 0,
      winchAtUpperLimit: (statusFlags & (1 << 2)) !== 0,
      winchAtLowerLimit: (statusFlags & (1 << 3)) !== 0,
      fuseActive: (statusFlags & (1 << 4)) !== 0,
      cargoWeightKg: dv.getUint16(payload + 5, true) / 10,
      totalWeightKg: dv.getUint16(payload + 7, true) / 10,
      ropeLengthCm: dv.getUint16(payload + 9, true),
      speedCmPerSecond: dv.getInt16(payload + 11, true),
      fuseTemperature: dv.getInt16(payload + 13, true),
      maximumLoadKg: dv.getUint16(payload + 15, true) / 10,
      maximumRopeLengthCm: dv.getUint16(payload + 17, true),
      maximumUpSpeedCmPerSecond: dv.getUint16(payload + 19, true),
      maximumDownSpeedCmPerSecond: dv.getUint16(payload + 21, true),
    };
  }

  return null;
}

/** Decode the ACFly K9 MISSION_CURRENT extensions (ID 42, 38 bytes). */
export function decodeACFlyK9MissionCurrent(dv: DataView): ACFlyK9MissionCurrentMsg {
  return {
    seq: dv.getUint16(0, true),
    resumeSeq: dv.getUint16(2, true),
    flag: dv.getUint16(4, true),
    heading: dv.getFloat32(6, true),
    vectorX: dv.getFloat32(10, true),
    vectorY: dv.getFloat32(14, true),
    vectorZ: dv.getFloat32(18, true),
    distance: dv.getFloat32(22, true),
    triggerInterval: dv.getFloat32(26, true),
    speed: dv.getFloat32(30, true),
    radius: dv.getFloat32(34, true),
  };
}
