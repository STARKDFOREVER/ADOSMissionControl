import { create } from "zustand";
import { RingBuffer } from "@/lib/ring-buffer";
import { createVersionBumper } from "./coalesced-version";
import type { AttitudeData, PositionData, BatteryData, GpsData, VfrData, RcData, SysStatusData, RadioData, EkfData, VibrationData, ServoOutputData, WindData, TerrainData, LocalPositionData, DebugData, GimbalData, ObstacleData, ScaledImuData, HomePositionData, PowerStatusData, DistanceSensorData, FenceStatusData, EstimatorStatusData, CameraTriggerData, NavControllerData } from "@/lib/types";
import type { INavAdsbVehicle } from "@/lib/protocol/types/inav";

/** Generic scalar telemetry sample for derived/quality channels. */
export interface TelemetrySample {
  ts: number;
  value: number;
}

/** Telemetry sample whose value may be unknown (e.g. unknown distance). */
export interface NullableTelemetrySample {
  ts: number;
  value: number | null;
}

/**
 * Heuristic VIO quality from an ODOMETRY poseCovariance row-major
 * upper-triangular array. Indices 0, 6, 11 are the diagonal entries
 * for x, y, z position variance in the 6x6 covariance matrix.
 * Returns 0..100 where higher means tighter covariance.
 */
export function computeVioQuality(poseCovariance: number[] | undefined): number {
  if (!poseCovariance || poseCovariance.length < 12) return 0;
  const vx = poseCovariance[0];
  const vy = poseCovariance[6];
  const vz = poseCovariance[11];
  if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) return 0;
  const trace = vx + vy + vz;
  const q = 100 - trace * 10;
  if (q < 0) return 0;
  if (q > 100) return 100;
  return q;
}

/** Ring capacity per telemetry channel, sized as rate x 60 s of history. */
export const CHANNEL_CAPACITY = {
  attitude: 600,        // 10Hz x 60s
  position: 300,        // 5Hz x 60s
  battery: 120,         // 2Hz x 60s
  gps: 300,             // 5Hz x 60s
  gps2: 300,            // 5Hz x 60s — GPS2_RAW
  vfr: 600,             // 10Hz x 60s
  rc: 600,              // 10Hz x 60s
  sysStatus: 60,        // 1Hz x 60s
  radio: 120,           // 2Hz x 60s
  ekf: 60,
  vibration: 120,
  servoOutput: 300,
  wind: 60,
  terrain: 60,
  localPosition: 300,   // 5Hz x 60s
  debug: 300,           // variable
  gimbal: 60,           // 1Hz x 60s
  obstacle: 30,         // 0.5Hz x 60s
  scaledImu: 120,       // 2Hz x 60s
  homePosition: 12,     // 0.2Hz x 60s
  powerStatus: 60,      // 1Hz x 60s
  distanceSensor: 120,  // 2Hz x 60s
  fenceStatus: 60,      // 1Hz x 60s
  estimatorStatus: 60,  // 1Hz x 60s
  cameraTrigger: 100,   // event-driven
  navController: 120,   // 2Hz x 60s
  flowQuality: 1000,    // ~10-50Hz, 20-100s window
  flowDistance: 1000,
  vioQuality: 1000,
} as const satisfies Record<keyof TelemetryRings, number>;

/** Every telemetry ring buffer, keyed by channel. */
interface TelemetryRings {
  attitude: RingBuffer<AttitudeData>;
  position: RingBuffer<PositionData>;
  battery: RingBuffer<BatteryData>;
  gps: RingBuffer<GpsData>;
  gps2: RingBuffer<GpsData>;
  vfr: RingBuffer<VfrData>;
  rc: RingBuffer<RcData>;
  sysStatus: RingBuffer<SysStatusData>;
  radio: RingBuffer<RadioData>;
  ekf: RingBuffer<EkfData>;
  vibration: RingBuffer<VibrationData>;
  servoOutput: RingBuffer<ServoOutputData>;
  wind: RingBuffer<WindData>;
  terrain: RingBuffer<TerrainData>;
  localPosition: RingBuffer<LocalPositionData>;
  debug: RingBuffer<DebugData>;
  gimbal: RingBuffer<GimbalData>;
  obstacle: RingBuffer<ObstacleData>;
  scaledImu: RingBuffer<ScaledImuData>;
  homePosition: RingBuffer<HomePositionData>;
  powerStatus: RingBuffer<PowerStatusData>;
  distanceSensor: RingBuffer<DistanceSensorData>;
  fenceStatus: RingBuffer<FenceStatusData>;
  estimatorStatus: RingBuffer<EstimatorStatusData>;
  cameraTrigger: RingBuffer<CameraTriggerData>;
  navController: RingBuffer<NavControllerData>;
  flowQuality: RingBuffer<TelemetrySample>;
  flowDistance: RingBuffer<NullableTelemetrySample>;
  vioQuality: RingBuffer<TelemetrySample>;
}

/** A fresh, empty ring per channel at its `CHANNEL_CAPACITY`. */
function makeRings(): TelemetryRings {
  const c = CHANNEL_CAPACITY;
  return {
    attitude: new RingBuffer(c.attitude),
    position: new RingBuffer(c.position),
    battery: new RingBuffer(c.battery),
    gps: new RingBuffer(c.gps),
    gps2: new RingBuffer(c.gps2),
    vfr: new RingBuffer(c.vfr),
    rc: new RingBuffer(c.rc),
    sysStatus: new RingBuffer(c.sysStatus),
    radio: new RingBuffer(c.radio),
    ekf: new RingBuffer(c.ekf),
    vibration: new RingBuffer(c.vibration),
    servoOutput: new RingBuffer(c.servoOutput),
    wind: new RingBuffer(c.wind),
    terrain: new RingBuffer(c.terrain),
    localPosition: new RingBuffer(c.localPosition),
    debug: new RingBuffer(c.debug),
    gimbal: new RingBuffer(c.gimbal),
    obstacle: new RingBuffer(c.obstacle),
    scaledImu: new RingBuffer(c.scaledImu),
    homePosition: new RingBuffer(c.homePosition),
    powerStatus: new RingBuffer(c.powerStatus),
    distanceSensor: new RingBuffer(c.distanceSensor),
    fenceStatus: new RingBuffer(c.fenceStatus),
    estimatorStatus: new RingBuffer(c.estimatorStatus),
    cameraTrigger: new RingBuffer(c.cameraTrigger),
    navController: new RingBuffer(c.navController),
    flowQuality: new RingBuffer(c.flowQuality),
    flowDistance: new RingBuffer(c.flowDistance),
    vioQuality: new RingBuffer(c.vioQuality),
  };
}

interface TelemetryStoreState extends TelemetryRings {
  _version: number;
  pushAttitude: (data: AttitudeData) => void;
  pushPosition: (data: PositionData) => void;
  pushBattery: (data: BatteryData) => void;
  pushGps: (data: GpsData) => void;
  pushGps2: (data: GpsData) => void;
  pushVfr: (data: VfrData) => void;
  pushRc: (data: RcData) => void;
  pushSysStatus: (data: SysStatusData) => void;
  pushRadio: (data: RadioData) => void;
  pushEkf: (data: EkfData) => void;
  pushVibration: (data: VibrationData) => void;
  pushServoOutput: (data: ServoOutputData) => void;
  pushWind: (data: WindData) => void;
  pushTerrain: (data: TerrainData) => void;
  pushLocalPosition: (data: LocalPositionData) => void;
  pushDebug: (data: DebugData) => void;
  pushGimbal: (data: GimbalData) => void;
  pushObstacle: (data: ObstacleData) => void;
  pushScaledImu: (data: ScaledImuData) => void;
  pushHomePosition: (data: HomePositionData) => void;
  pushPowerStatus: (data: PowerStatusData) => void;
  pushDistanceSensor: (data: DistanceSensorData) => void;
  pushFenceStatus: (data: FenceStatusData) => void;
  pushEstimatorStatus: (data: EstimatorStatusData) => void;
  pushCameraTrigger: (data: CameraTriggerData) => void;
  pushNavController: (data: NavControllerData) => void;
  pushFlowQuality: (ts: number, q: number) => void;
  pushFlowDistance: (ts: number, d: number | null) => void;
  pushVioQuality: (ts: number, q: number) => void;

  // iNav-specific fields (MSP_NAV_STATUS mode/state/activeWpAction)
  navMode: number | null;
  navState: number | null;
  navAction: number | null;
  navStatusUpdated: number;
  armingFlags: number | null;
  /** Betaflight ARMING_DISABLE_FLAGS_COUNT sent beside the word (the last flag
   * is ARM_SWITCH, so it fixes the bit layout); null for iNav, which has none. */
  armingFlagCount: number | null;
  /** When `armingFlags` was last received; 0 before any MSP status. */
  armingFlagsUpdatedAt: number;
  adsbVehicles: INavAdsbVehicle[];
  /** When `adsbVehicles` was last replaced; 0 before any traffic list. */
  adsbUpdatedAt: number;

  setNavStatus: (mode: number, state: number, action: number) => void;
  setArmingFlags: (flags: number, flagCount: number | null) => void;
  setAdsbVehicles: (vehicles: INavAdsbVehicle[]) => void;

  pushBatch: (batch: Partial<{
    attitude: AttitudeData;
    position: PositionData;
    battery: BatteryData;
    gps: GpsData;
    gps2: GpsData;
    vfr: VfrData;
    rc: RcData;
    sysStatus: SysStatusData;
    radio: RadioData;
    ekf: EkfData;
    vibration: VibrationData;
    servoOutput: ServoOutputData;
    wind: WindData;
    terrain: TerrainData;
    localPosition: LocalPositionData;
    debug: DebugData;
    gimbal: GimbalData;
    obstacle: ObstacleData;
    scaledImu: ScaledImuData;
    homePosition: HomePositionData;
    powerStatus: PowerStatusData;
    distanceSensor: DistanceSensorData;
    fenceStatus: FenceStatusData;
    estimatorStatus: EstimatorStatusData;
    cameraTrigger: CameraTriggerData;
    navController: NavControllerData;
  }>) => void;
  clear: () => void;
}

// Coalesce version bumps — at 35+ pushes/sec, batch into one Zustand set() per
// animation frame. The bumper itself is the shared store primitive; every store
// fed by live telemetry uses it (see `./coalesced-version`).
const bumper = createVersionBumper(() =>
  useTelemetryStore.setState((s) => ({ _version: s._version + 1 })),
);
const scheduleVersionBump = bumper.scheduleVersionBump;

/** Test/debug affordance: true while a coalesced bump is pending. */
export const telemetryBumpPending = bumper.hasPendingBump;

export const useTelemetryStore = create<TelemetryStoreState>((set, get) => ({
  _version: 0,
  ...makeRings(),

  pushAttitude: (data) => { get().attitude.push(data); scheduleVersionBump(); },
  pushPosition: (data) => { get().position.push(data); scheduleVersionBump(); },
  pushBattery: (data) => { get().battery.push(data); scheduleVersionBump(); },
  pushGps: (data) => { get().gps.push(data); scheduleVersionBump(); },
  pushGps2: (data) => { get().gps2.push(data); scheduleVersionBump(); },
  pushVfr: (data) => { get().vfr.push(data); scheduleVersionBump(); },
  pushRc: (data) => { get().rc.push(data); scheduleVersionBump(); },
  pushSysStatus: (data) => { get().sysStatus.push(data); scheduleVersionBump(); },
  pushRadio: (data) => { get().radio.push(data); scheduleVersionBump(); },
  pushEkf: (data) => { get().ekf.push(data); scheduleVersionBump(); },
  pushVibration: (data) => { get().vibration.push(data); scheduleVersionBump(); },
  pushServoOutput: (data) => { get().servoOutput.push(data); scheduleVersionBump(); },
  pushWind: (data) => { get().wind.push(data); scheduleVersionBump(); },
  pushTerrain: (data) => { get().terrain.push(data); scheduleVersionBump(); },
  pushLocalPosition: (data) => { get().localPosition.push(data); scheduleVersionBump(); },
  pushDebug: (data) => { get().debug.push(data); scheduleVersionBump(); },
  pushGimbal: (data) => { get().gimbal.push(data); scheduleVersionBump(); },
  pushObstacle: (data) => { get().obstacle.push(data); scheduleVersionBump(); },
  pushScaledImu: (data) => { get().scaledImu.push(data); scheduleVersionBump(); },
  pushHomePosition: (data) => { get().homePosition.push(data); scheduleVersionBump(); },
  pushPowerStatus: (data) => { get().powerStatus.push(data); scheduleVersionBump(); },
  pushDistanceSensor: (data) => { get().distanceSensor.push(data); scheduleVersionBump(); },
  pushFenceStatus: (data) => { get().fenceStatus.push(data); scheduleVersionBump(); },
  pushEstimatorStatus: (data) => { get().estimatorStatus.push(data); scheduleVersionBump(); },
  pushCameraTrigger: (data) => { get().cameraTrigger.push(data); scheduleVersionBump(); },
  pushNavController: (data) => { get().navController.push(data); scheduleVersionBump(); },
  pushFlowQuality: (ts, q) => { get().flowQuality.push({ ts, value: q }); scheduleVersionBump(); },
  pushFlowDistance: (ts, d) => { get().flowDistance.push({ ts, value: d }); scheduleVersionBump(); },
  pushVioQuality: (ts, q) => { get().vioQuality.push({ ts, value: q }); scheduleVersionBump(); },

  navMode: null,
  navState: null,
  navAction: null,
  navStatusUpdated: 0,
  armingFlags: null,
  armingFlagCount: null,
  armingFlagsUpdatedAt: 0,
  adsbVehicles: [],
  adsbUpdatedAt: 0,

  setNavStatus: (mode, state, action) =>
    set({ navMode: mode, navState: state, navAction: action, navStatusUpdated: Date.now() }),
  setArmingFlags: (flags, flagCount) =>
    set({ armingFlags: flags, armingFlagCount: flagCount, armingFlagsUpdatedAt: Date.now() }),
  setAdsbVehicles: (vehicles) => set({ adsbVehicles: vehicles.slice(0, 32), adsbUpdatedAt: Date.now() }),

  pushBatch: (batch) => {
    const s = get();
    if (batch.attitude) s.attitude.push(batch.attitude);
    if (batch.position) s.position.push(batch.position);
    if (batch.battery) s.battery.push(batch.battery);
    if (batch.gps) s.gps.push(batch.gps);
    if (batch.gps2) s.gps2.push(batch.gps2);
    if (batch.vfr) s.vfr.push(batch.vfr);
    if (batch.rc) s.rc.push(batch.rc);
    if (batch.sysStatus) s.sysStatus.push(batch.sysStatus);
    if (batch.radio) s.radio.push(batch.radio);
    if (batch.ekf) s.ekf.push(batch.ekf);
    if (batch.vibration) s.vibration.push(batch.vibration);
    if (batch.servoOutput) s.servoOutput.push(batch.servoOutput);
    if (batch.wind) s.wind.push(batch.wind);
    if (batch.terrain) s.terrain.push(batch.terrain);
    if (batch.localPosition) s.localPosition.push(batch.localPosition);
    if (batch.debug) s.debug.push(batch.debug);
    if (batch.gimbal) s.gimbal.push(batch.gimbal);
    if (batch.obstacle) s.obstacle.push(batch.obstacle);
    if (batch.scaledImu) s.scaledImu.push(batch.scaledImu);
    if (batch.homePosition) s.homePosition.push(batch.homePosition);
    if (batch.powerStatus) s.powerStatus.push(batch.powerStatus);
    if (batch.distanceSensor) s.distanceSensor.push(batch.distanceSensor);
    if (batch.fenceStatus) s.fenceStatus.push(batch.fenceStatus);
    if (batch.estimatorStatus) s.estimatorStatus.push(batch.estimatorStatus);
    if (batch.cameraTrigger) s.cameraTrigger.push(batch.cameraTrigger);
    if (batch.navController) s.navController.push(batch.navController);
    scheduleVersionBump();
  },
  clear: () => {
    // Drop any bump scheduled by a push that landed in this frame; without
    // this it fires after the reset and notifies against the fresh rings.
    bumper.cancelVersionBump();
    // One synchronous bump for the reset itself: surfaces that select only
    // `_version` and read the rings through getState() must re-render against
    // the empty rings, not keep drawing the previous drone's last sample.
    set((s) => ({
      _version: s._version + 1,
      ...makeRings(),
      navMode: null,
      navState: null,
      navAction: null,
      navStatusUpdated: 0,
      armingFlags: null,
      armingFlagCount: null,
      armingFlagsUpdatedAt: 0,
      adsbVehicles: [],
      adsbUpdatedAt: 0,
    }));
  },
}));
