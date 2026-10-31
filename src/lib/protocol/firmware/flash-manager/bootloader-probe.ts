/**
 * Bootloader acquisition helpers for the flash orchestrator: the PX4-protocol
 * bootloader wait, the DFU known-device poll and the STM32 ROM sync probe.
 *
 * @module protocol/firmware/flash-manager/bootloader-probe
 */

import type { FlashProgressCallback, FlashLogCallback, FlashUserAction, FirmwareFlasher } from "../types";
import { STM32DfuFlasher } from "../stm32-dfu";
import { PX4SerialFlasher } from "../px4-serial";
import { serialPortManager } from "@/lib/serial-port-manager";
import { ALL_FC_BOOTLOADER_IDS } from "@/lib/serial-bootloader-ids";

/** Max ms to wait for a re-enumerated bootloader device after reboot. */
const BOOTLOADER_POLL_MAX_MS = 20000;
/** Ms between DFU known-device polls. */
const DFU_POLL_INTERVAL_MS = 700;

/** What the PX4 bootloader wait needs from the running flash. */
export interface Px4WaitDeps {
  allowBoardIdMismatch: boolean;
  onLog: FlashLogCallback | undefined;
  log: (level: "debug" | "info" | "warning" | "error", message: string) => void;
  /** Block until the user picks a serial bootloader device (a real click). */
  selectSerial: (action: FlashUserAction, onProgress: FlashProgressCallback, signal: AbortSignal) => Promise<SerialPort>;
}

export function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Flash aborted by user");
}

/**
 * PX4-protocol bootloader path (PX4 and ArduPilot USB bootloaders). Bridge
 * fast path (probe the existing handle) -> native re-enumeration recovery ->
 * user-gesture picker fallback.
 */
export async function waitForPx4Bootloader(
  existingPort: SerialPort | null,
  onProgress: FlashProgressCallback,
  signal: AbortSignal,
  deps: Px4WaitDeps,
): Promise<FirmwareFlasher> {
  const knownBefore = await serialPortManager.snapshotKnownPorts();
  await delay(1500);

  // Bridge fast path: probe the reused handle. trySync leaves it open+synced.
  if (existingPort) {
    onProgress({ phase: "bootloader_wait", percent: 7, message: "Detecting bootloader..." });
    const probe = new PX4SerialFlasher(existingPort, { allowBoardIdMismatch: deps.allowBoardIdMismatch });
    if (await probe.trySync(2500, deps.onLog)) {
      onProgress({ phase: "bootloader_init", percent: 9, message: "Bootloader detected" });
      deps.log("info", "bootloader detected on existing port (bridge board)");
      return probe;
    }
    await probe.dispose();
  }

  // Native USB: the device re-enumerated as a new bootloader device.
  deps.log("info", "existing port did not respond — waiting for re-enumerated bootloader");
  const recovered = await serialPortManager.waitForBootloaderPort({
    knownBefore,
    ids: ALL_FC_BOOTLOADER_IDS,
    timeoutMs: BOOTLOADER_POLL_MAX_MS,
    signal,
    onTick: (ms) => onProgress({
      phase: "bootloader_wait",
      percent: 6 + Math.min(3, Math.round((ms / BOOTLOADER_POLL_MAX_MS) * 3)),
      message: `Waiting for bootloader... (${Math.round(ms / 1000)}s)`,
    }),
  });
  if (recovered) {
    const f = new PX4SerialFlasher(recovered, { allowBoardIdMismatch: deps.allowBoardIdMismatch });
    if (await f.trySync(3000, deps.onLog)) {
      onProgress({ phase: "bootloader_init", percent: 9, message: "Bootloader detected" });
      deps.log("info", "bootloader detected on re-enumerated port");
      return f;
    }
    await f.dispose();
  }

  // Fallback: the bootloader is present but was never permission-granted.
  const port = await deps.selectSerial(
    { kind: "select-bootloader", filters: [...ALL_FC_BOOTLOADER_IDS] },
    onProgress,
    signal,
  );
  return new PX4SerialFlasher(port, { allowBoardIdMismatch: deps.allowBoardIdMismatch });
}

/** Poll for an already-permitted DFU device for a few seconds. */
export async function pollForDfu(
  onProgress: FlashProgressCallback,
  signal: AbortSignal,
): Promise<{ device: USBDevice; label: string } | null> {
  const attempts = Math.ceil(BOOTLOADER_POLL_MAX_MS / DFU_POLL_INTERVAL_MS);
  for (let i = 0; i < attempts; i++) {
    checkAbort(signal);
    try {
      const known = await STM32DfuFlasher.getKnownDevices();
      if (known.length > 0) return { device: known[0].device, label: known[0].label };
    } catch {
      /* keep polling */
    }
    onProgress({
      phase: "bootloader_wait",
      percent: 6 + Math.min(3, Math.round(((i + 1) / attempts) * 3)),
      message: `Waiting for DFU device... (${Math.round(((i + 1) * DFU_POLL_INTERVAL_MS) / 1000)}s)`,
    });
    await delay(DFU_POLL_INTERVAL_MS);
  }
  return null;
}

/**
 * Probe a serial port for the STM32 ROM bootloader (AN3155).
 *
 * Opens with bootloader settings (115200, even parity), sends the 0x7F sync
 * byte, and checks for ACK (0x79) or echo (0x7F). Closes afterwards so the
 * STM32SerialFlasher can open it fresh.
 */
export async function probeStRomSync(port: SerialPort): Promise<boolean> {
  const SYNC = 0x7f;
  const ACK = 0x79;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  try {
    await port.open({ baudRate: 115200, parity: "even", stopBits: 1, dataBits: 8 });

    if (!port.readable || !port.writable) {
      await port.close().catch(() => {});
      return false;
    }

    reader = port.readable.getReader();
    writer = port.writable.getWriter();

    await writer.write(new Uint8Array([SYNC]));

    const response = await Promise.race([
      reader.read(),
      delay(500).then(() => ({ value: undefined, done: true as const })),
    ]);

    const byte = response.value && response.value.length > 0 ? response.value[0] : null;
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    reader = null;
    await writer.close().catch(() => {});
    writer.releaseLock();
    writer = null;
    await port.close().catch(() => {});
    return byte === ACK || byte === SYNC;
  } catch {
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (writer) { await writer.close().catch(() => {}); writer.releaseLock(); }
    await port.close().catch(() => {});
    return false;
  }
}
