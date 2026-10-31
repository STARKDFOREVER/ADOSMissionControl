/**
 * Flash refusal rules and the outcome type, checked before anything touches
 * the flight controller.
 *
 * @module protocol/firmware/flash-manager/refusal
 */

import type { DroneProtocol, Transport } from "../../types";
import type { FlashOptions, ParsedFirmware } from "../types";
import { WITH_BL_REQUIRED_MESSAGE } from "../types";
import { bootloaderAppImage } from "../px4-serial-helpers";
import type { FlashParamBackup } from "../param-backup";

// ── Progress Phase Ranges ──────────────────────────────
//
// Backup:          0-5%
// Reboot:          5-6%
// Bootloader wait: 6-9%
// Bootloader init: 9-10%
// Erase:           10-25%
// Flash:           25-75%
// Verify:          75-95%
// Reboot:          95-100%

/** Refusal when the selected flight controller is not on a local USB serial link. */
export const USB_REQUIRED_MESSAGE = "Flashing needs a USB cable to the flight controller.";

/** The flasher a run resolves to once the image kind is known. */
export type ResolvedMethod = "px4-serial" | "dfu" | "st-rom-serial" | "absolute-auto";

/** What a completed flash leaves for the operator. */
export interface FlashOutcome {
  /** Parameters saved before the reboot, offered for a reviewed restore. */
  paramBackup: FlashParamBackup | null;
}

/**
 * Why a flash with this link, image and method must not start, or null.
 * Checked before anything touches the flight controller.
 */
export function flashRefusal(
  protocol: Pick<DroneProtocol, "isConnected"> | null,
  transport: Pick<Transport, "type"> | null,
  firmware: ParsedFirmware,
  method: FlashOptions["method"],
): string | null {
  if (protocol?.isConnected && transport?.type !== "webserial") return USB_REQUIRED_MESSAGE;
  if ((method === "dfu" || method === "st-rom-serial") && firmware.bootloaderApp) return WITH_BL_REQUIRED_MESSAGE;
  if (method === "px4-serial") {
    try {
      bootloaderAppImage(firmware);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
  return null;
}
