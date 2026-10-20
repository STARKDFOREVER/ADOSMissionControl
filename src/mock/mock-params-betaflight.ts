/**
 * @license GPL-3.0-only
 */

import type { MockParam } from "./mock-params";

/**
 * Betaflight parameters for demo mode.
 *
 * Realistic BF parameter names with typical defaults covering
 * PID, rates, motor, battery, failsafe, GPS, blackbox, VTX, and features.
 */
export const BETAFLIGHT_MOCK_PARAMS: MockParam[] = [
  // ── PID ────────────────────────────────────────────────
  { name: "BF_PID_ROLL_P", value: 45, type: 9 },
  { name: "BF_PID_ROLL_I", value: 80, type: 9 },
  { name: "BF_PID_ROLL_D", value: 40, type: 9 },
  { name: "BF_PID_PITCH_P", value: 47, type: 9 },
  { name: "BF_PID_PITCH_I", value: 84, type: 9 },
  { name: "BF_PID_PITCH_D", value: 46, type: 9 },
  { name: "BF_PID_YAW_P", value: 45, type: 9 },
  { name: "BF_PID_YAW_I", value: 80, type: 9 },
  { name: "BF_PID_YAW_D", value: 0, type: 9 },
  { name: "BF_PID_ROLL_F", value: 120, type: 9 },
  { name: "BF_PID_PITCH_F", value: 125, type: 9 },
  { name: "BF_PID_YAW_F", value: 120, type: 9 },
  // ── Rates ──────────────────────────────────────────────
  { name: "BF_RATES_TYPE", value: 3, type: 9 },
  { name: "BF_RC_RATE", value: 7, type: 9 },
  { name: "BF_RC_EXPO", value: 0, type: 9 },
  { name: "BF_ROLL_RATE", value: 67, type: 9 },
  { name: "BF_PITCH_RATE", value: 67, type: 9 },
  { name: "BF_RC_PITCH_RATE", value: 7, type: 9 },
  { name: "BF_RC_PITCH_EXPO", value: 0, type: 9 },
  { name: "BF_YAW_RATE", value: 67, type: 9 },
  { name: "BF_RC_YAW_EXPO", value: 0, type: 9 },
  { name: "BF_RC_YAW_RATE", value: 7, type: 9 },
  { name: "BF_ROLL_RATE_LIMIT", value: 1998, type: 9 },
  { name: "BF_PITCH_RATE_LIMIT", value: 1998, type: 9 },
  { name: "BF_YAW_RATE_LIMIT", value: 1998, type: 9 },
  { name: "BF_THROTTLE_MID", value: 50, type: 9 },
  { name: "BF_THROTTLE_EXPO", value: 0, type: 9 },
  // ── Motor ──────────────────────────────────────────────
  { name: "BF_MOTOR_MIN_THROTTLE", value: 1070, type: 9 },
  { name: "BF_MOTOR_MAX_THROTTLE", value: 2000, type: 9 },
  { name: "BF_MOTOR_MIN_COMMAND", value: 1000, type: 9 },
  { name: "BF_MOTOR_IDLE_PCT", value: 550, type: 9 },
  { name: "BF_MOTOR_PWM_PROTOCOL", value: 5, type: 9 },
  { name: "BF_MOTOR_PWM_RATE", value: 480, type: 9 },
  // ── Battery ────────────────────────────────────────────
  { name: "BF_BATT_MIN_CELL", value: 330, type: 9 },
  { name: "BF_BATT_MAX_CELL", value: 430, type: 9 },
  { name: "BF_BATT_WARNING_CELL", value: 350, type: 9 },
  { name: "BF_BATT_CAPACITY", value: 0, type: 9 },
  // ── Features & arming ─────────────────────────────────
  { name: "BF_FEATURE_MASK", value: 0x20000064, type: 9 },
  { name: "BF_AUTO_DISARM_DELAY", value: 5, type: 9 },
  { name: "BF_SMALL_ANGLE", value: 25, type: 9 },
  { name: "BF_BEEPER_DISABLED_MASK", value: 0, type: 9 },
  // ── Filters ────────────────────────────────────────────
  { name: "BF_GYRO_LPF_HZ", value: 250, type: 9 },
  { name: "BF_DTERM_LPF_HZ", value: 100, type: 9 },
  { name: "BF_GYRO_NOTCH_HZ", value: 0, type: 9 },
  { name: "BF_GYRO_NOTCH_CUTOFF", value: 0, type: 9 },
  { name: "BF_DTERM_NOTCH_HZ", value: 0, type: 9 },
  { name: "BF_DTERM_NOTCH_CUTOFF", value: 0, type: 9 },
  { name: "BF_GYRO_SYNC_DENOM", value: 1, type: 9 },
  { name: "BF_PID_PROCESS_DENOM", value: 1, type: 9 },
  // ── Failsafe ───────────────────────────────────────────
  { name: "BF_FS_DELAY", value: 4, type: 9 },
  { name: "BF_FS_PROCEDURE", value: 0, type: 9 },
  // ── GPS ────────────────────────────────────────────────
  { name: "BF_GPS_PROVIDER", value: 1, type: 9 },
  { name: "BF_GPS_SBAS_MODE", value: 0, type: 9 },
  { name: "BF_GPS_AUTO_CONFIG", value: 1, type: 9 },
  { name: "BF_GPS_AUTO_BAUD", value: 0, type: 9 },
  { name: "BF_GPS_USE_GALILEO", value: 0, type: 9 },
  { name: "BF_GPS_RESCUE_ANGLE", value: 30, type: 9 },
  { name: "BF_GPS_RESCUE_INITIAL_ALT", value: 30, type: 9 },
  { name: "BF_GPS_RESCUE_DESCENT_DIST", value: 200, type: 9 },
  { name: "BF_GPS_RESCUE_GROUND_SPEED", value: 750, type: 9 },
  { name: "BF_GPS_RESCUE_THROTTLE_MIN", value: 1100, type: 9 },
  { name: "BF_GPS_RESCUE_THROTTLE_MAX", value: 1600, type: 9 },
  { name: "BF_GPS_RESCUE_THROTTLE_HOVER", value: 1280, type: 9 },
  { name: "BF_GPS_RESCUE_SANITY_CHECKS", value: 1, type: 9 },
  { name: "BF_GPS_RESCUE_MIN_SATS", value: 8, type: 9 },
  // ── Blackbox ───────────────────────────────────────────
  { name: "BF_BLACKBOX_DEVICE", value: 1, type: 9 },
  { name: "BF_BLACKBOX_RATE_NUM", value: 1, type: 9 },
  { name: "BF_BLACKBOX_RATE_DENOM", value: 1, type: 9 },
  // ── VTX ────────────────────────────────────────────────
  { name: "BF_VTX_TYPE", value: 3, type: 9 },
  { name: "BF_VTX_BAND", value: 4, type: 9 },
  { name: "BF_VTX_CHANNEL", value: 1, type: 9 },
  { name: "BF_VTX_POWER", value: 1, type: 9 },
  { name: "BF_VTX_PIT_MODE", value: 0, type: 9 },
  { name: "BF_VTX_FREQUENCY", value: 0, type: 9 },
  { name: "BF_VTX_LOW_POWER_DISARM", value: 0, type: 9 },

  // ── Scripting (SCR_*) ────────────────────────────────
  { name: "SCR_ENABLE", value: 1, type: 9 },
  { name: "SCR_HEAP_SIZE", value: 102400, type: 9 },
  { name: "SCR_VM_I_COUNT", value: 10000, type: 9 },
  { name: "SCR_DEBUG_OPTS", value: 0, type: 9 },
  { name: "SCR_DIR_DISABLE", value: 0, type: 9 },
  { name: "SCR_THD_PRIORITY", value: 0, type: 9 },
];
