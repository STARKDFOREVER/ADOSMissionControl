/**
 * Firmware + vehicle-class variants the demo fleet can instantiate.
 *
 * @license GPL-3.0-only
 */

export type MockFirmware =
  | "ardupilot-copter"
  | "ardupilot-heli"
  | "ardupilot-plane"
  | "ardupilot-plane-vtol"
  | "ardupilot-plane-tailsitter"
  | "ardupilot-plane-tiltrotor"
  | "ardupilot-rover"
  | "ardupilot-boat"
  | "ardupilot-sub"
  | "px4"
  | "px4-vtol"
  | "betaflight"
  | "inav-plane";
