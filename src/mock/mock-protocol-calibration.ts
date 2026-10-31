/**
 * Mock calibration simulation logic for MockProtocol.
 *
 * Extracted to keep mock-protocol.ts under 300 lines.
 * Each function takes a context object providing access to MockProtocol's
 * internal state and emit methods.
 *
 * @license GPL-3.0-only
 */

import type {
  CommandResult,
  AccelCalPosition,
  MagCalProgressCallback,
  MagCalReportCallback,
  AccelCalPosCallback,
} from "@/lib/protocol/types";

export interface CalibrationContext {
  vehicleFirmwareType: string;
  isPX4: boolean;
  /** Every timeout/interval handle a calibration run schedules. */
  calTimers: CalTimer[];
  magCalProgressCbs: MagCalProgressCallback[];
  magCalReportCbs: MagCalReportCallback[];
  accelCalPosCbs: AccelCalPosCallback[];
  emitStatusText(severity: number, text: string): void;
  emitAccelCalPos(position: AccelCalPosition): void;
  /** Clears every handle in `calTimers` (cancel, new run, disconnect). */
  clearCalTimers(): void;
}

export type CalTimer = ReturnType<typeof setTimeout | typeof setInterval>;

function after(ctx: CalibrationContext, fn: () => void, ms: number): void {
  ctx.calTimers.push(setTimeout(fn, ms));
}

function every(ctx: CalibrationContext, fn: () => void, ms: number): ReturnType<typeof setInterval> {
  const iv = setInterval(fn, ms);
  ctx.calTimers.push(iv);
  return iv;
}

function ok(message = "OK"): CommandResult {
  return { success: true, resultCode: 0, message };
}

export function mockStartCalibration(
  ctx: CalibrationContext,
  type: "accel" | "gyro" | "compass" | "level" | "airspeed" | "baro" | "rc" | "esc" | "compassmot",
): CommandResult {
  ctx.emitStatusText(6, `${type} calibration started`);

  if (type === "accel") {
    if (ctx.isPX4) {
      ctx.clearCalTimers();
      const sides = ["back", "front", "left", "right", "up", "down"];
      ctx.emitStatusText(6, "[cal] calibration started: 4");
      let progress = 0;
      let sideIdx = 0;
      const iv = every(ctx, () => {
        progress += 8;
        if (sideIdx < sides.length) {
          ctx.emitStatusText(6, `[cal] progress <${Math.min(progress, 95)}>`);
          if (progress % 16 === 0 && sideIdx < sides.length) {
            ctx.emitStatusText(6, `[cal] ${sides[sideIdx]} side done, rotate to a different side`);
            sideIdx++;
          }
        }
        if (progress >= 100) {
          clearInterval(iv);
          ctx.emitStatusText(6, "[cal] calibration done: accel");
        }
      }, 500);
    } else {
      ctx.clearCalTimers();
      after(ctx, () => ctx.emitAccelCalPos(1 as AccelCalPosition), 500);
    }
  } else if (type === "compass") {
    if (ctx.isPX4) {
      ctx.clearCalTimers();
      ctx.emitStatusText(6, "[cal] calibration started: 2");
      let progress = 0;
      const iv = every(ctx, () => {
        progress += 10;
        if (progress < 100) {
          ctx.emitStatusText(6, `[cal] progress <${progress}>`);
        } else {
          clearInterval(iv);
          ctx.emitStatusText(6, "[cal] calibration done: mag");
        }
      }, 500);
    } else {
      mockStartArduCompassCal(ctx);
    }
  } else if (type === "rc") {
    return { success: true, resultCode: 0, message: "RC calibration ready — follow on-screen instructions" };
  } else if (type === "esc") {
    ctx.emitStatusText(3, "WARNING: ESC calibration will spin motors! Remove props!");
    after(ctx, () => ctx.emitStatusText(6, "ESC calibration: Set throttle to maximum"), 1000);
    after(ctx, () => ctx.emitStatusText(6, "ESC calibration: 50%"), 2000);
    after(ctx, () => ctx.emitStatusText(5, "ESC calibration successful"), 3500);
  } else if (type === "compassmot") {
    after(ctx, () => ctx.emitStatusText(6, "CompassMot: Increasing throttle..."), 1000);
    after(ctx, () => ctx.emitStatusText(6, "CompassMot interference: 12% — Good"), 3000);
    after(ctx, () => ctx.emitStatusText(5, "CompassMot calibration successful"), 4000);
  } else if (type === "gyro") {
    if (ctx.isPX4) {
      ctx.emitStatusText(6, "[cal] calibration started: 5");
      let progress = 0;
      const iv = every(ctx, () => {
        progress += 20;
        if (progress < 100) {
          ctx.emitStatusText(6, `[cal] progress <${progress}>`);
        } else {
          clearInterval(iv);
          ctx.emitStatusText(6, "[cal] calibration done: gyro");
        }
      }, 400);
    } else {
      after(ctx, () => ctx.emitStatusText(6, "Gyro calibration started"), 200);
      after(ctx, () => ctx.emitStatusText(6, "Gyro calibration: 50%"), 1000);
      after(ctx, () => ctx.emitStatusText(5, "Gyro cal done"), 1800);
      after(ctx, () => ctx.emitStatusText(5, "gyro calibration successful"), 2000);
    }
  } else if (type === "level") {
    if (ctx.isPX4) {
      ctx.emitStatusText(6, "[cal] calibration started: 6");
      let progress = 0;
      const iv = every(ctx, () => {
        progress += 25;
        if (progress < 100) {
          ctx.emitStatusText(6, `[cal] progress <${progress}>`);
        } else {
          clearInterval(iv);
          ctx.emitStatusText(6, "[cal] calibration done: level");
        }
      }, 350);
    } else {
      after(ctx, () => ctx.emitStatusText(6, "Level calibration started"), 200);
      after(ctx, () => ctx.emitStatusText(5, "Trim OK: roll=0.00 pitch=0.00 yaw=0.00"), 1500);
      after(ctx, () => ctx.emitStatusText(5, "level calibration successful"), 2000);
    }
  } else {
    if (ctx.isPX4) {
      const calTypeId = type === "airspeed" ? 7 : 8;
      ctx.emitStatusText(6, `[cal] calibration started: ${calTypeId}`);
      let progress = 0;
      const iv = every(ctx, () => {
        progress += 20;
        if (progress < 100) {
          ctx.emitStatusText(6, `[cal] progress <${progress}>`);
        } else {
          clearInterval(iv);
          ctx.emitStatusText(6, `[cal] calibration done: ${type}`);
        }
      }, 500);
    } else {
      after(ctx, () => ctx.emitStatusText(6, `${type} calibration: 50%`), 1000);
      after(ctx, () => ctx.emitStatusText(5, `${type} calibration successful`), 2000);
    }
  }

  return ok(`${type} calibration started`);
}

function mockStartArduCompassCal(ctx: CalibrationContext): void {
  ctx.clearCalTimers();
  let pct0 = 0;
  let pct1 = 0;
  let tick = 0;
  const mask0 = new Uint8Array(10);
  const mask1 = new Uint8Array(10);

  const iv = every(ctx, () => {
    tick++;
    const angle0 = tick * 0.3;
    const angle1 = tick * 0.25;

    pct0 = Math.min(100, pct0 + 5);
    const sectors0 = Math.floor((pct0 / 100) * 80);
    for (let b = 0; b < sectors0; b++) {
      mask0[Math.floor(b / 8)] |= (1 << (b % 8));
    }
    for (const cb of ctx.magCalProgressCbs) {
      cb({
        compassId: 0, completionPct: pct0,
        calStatus: pct0 < 50 ? 2 : 3,
        completionMask: Array.from(mask0),
        directionX: Math.cos(angle0), directionY: Math.sin(angle0),
        directionZ: Math.sin(angle0 * 0.7),
      });
    }

    if (tick >= 2) {
      pct1 = Math.min(100, pct1 + 4);
      const sectors1 = Math.floor((pct1 / 100) * 80);
      for (let b = 0; b < sectors1; b++) {
        mask1[Math.floor(b / 8)] |= (1 << (b % 8));
      }
      for (const cb of ctx.magCalProgressCbs) {
        cb({
          compassId: 1, completionPct: pct1,
          calStatus: pct1 < 50 ? 2 : 3,
          completionMask: Array.from(mask1),
          directionX: Math.sin(angle1), directionY: Math.cos(angle1),
          directionZ: -Math.sin(angle1 * 0.5),
        });
      }
    }

    if (pct0 >= 100 && pct1 >= 100) {
      clearInterval(iv);
      after(ctx, () => {
        for (const cb of ctx.magCalReportCbs) {
          cb({
            compassId: 0, calStatus: 4, autosaved: 0,
            ofsX: 42.3, ofsY: -18.7, ofsZ: 105.1, fitness: 6.2,
            diagX: 1.02, diagY: 0.98, diagZ: 1.01,
            offdiagX: 0.005, offdiagY: -0.012, offdiagZ: 0.008,
            orientationConfidence: 0.95,
            oldOrientation: 0, newOrientation: 0, scaleFactor: 1.0,
          });
        }
      }, 300);
      const compass1Fails = Math.random() < 0.3;
      after(ctx, () => {
        for (const cb of ctx.magCalReportCbs) {
          cb({
            compassId: 1, calStatus: compass1Fails ? 6 : 4, autosaved: 0,
            ofsX: -87.5, ofsY: 134.2, ofsZ: -62.8, fitness: 18.5,
            diagX: 0.95, diagY: 1.08, diagZ: 0.97,
            offdiagX: 0.042, offdiagY: -0.031, offdiagZ: 0.015,
            orientationConfidence: 0.88,
            oldOrientation: 0, newOrientation: 0, scaleFactor: 1.0,
          });
        }
      }, 500);
    }
  }, 250);
}
