/**
 * Firmware flash orchestrator: backup, reboot to bootloader, acquire the
 * bootloader and run the flasher.
 *
 * @module protocol/firmware/flash-manager/manager
 */

import type { DroneProtocol, Transport } from "../../types";
import type { FlashOptions, FlashProgressCallback, FlashLogCallback, FlashUserAction, ParsedFirmware, FirmwareFlasher } from "../types";
import { STM32SerialFlasher } from "../stm32-serial";
import { STM32DfuFlasher } from "../stm32-dfu";
import { saveFlashParamBackup, type FlashParamBackup } from "../param-backup";
import { ParamDownloadIncompleteError } from "../../mavlink-adapter-params";
import { toSerialFilters } from "@/lib/serial-bootloader-ids";
import { flashRefusal, type FlashOutcome, type ResolvedMethod } from "./refusal";
import { checkAbort, delay, pollForDfu, probeStRomSync, waitForPx4Bootloader } from "./bootloader-probe";

// ── FlashManager ───────────────────────────────────────

export class FlashManager {
  private protocol: DroneProtocol | null;
  private transport: Transport | null;
  private abortController: AbortController | null = null;
  private flasher: FirmwareFlasher | null = null;
  private onLog: FlashLogCallback | null = null;
  private allowBoardIdMismatch = false;

  // Pause/resume for the user-gesture device pickers. The recovery flow blocks
  // on these resolvers; the UI button handler calls selectBootloaderManually,
  // which runs the picker INSIDE the click gesture and settles the resolver.
  private pendingSerialResolver: ((port: SerialPort) => void) | null = null;
  private pendingUsbResolver: ((device: USBDevice) => void) | null = null;

  constructor(protocol: DroneProtocol | null, transport: Transport | null) {
    this.protocol = protocol;
    this.transport = transport;
  }

  /**
   * Execute the full firmware flash workflow.
   */
  async flash(
    firmware: ParsedFirmware,
    options: FlashOptions,
    onProgress: FlashProgressCallback,
    onLog?: FlashLogCallback,
  ): Promise<FlashOutcome> {
    if (options.method === "dronecan-ota") {
      throw new Error(
        "DroneCAN OTA flashes run through the AP_Periph flow (DroneCanOtaOrchestrator " +
          "over a live DroneCAN bus). FlashManager's bootloader-poll path does not own the CAN bus.",
      );
    }
    this.onLog = onLog ?? null;
    this.allowBoardIdMismatch = options.allowBoardIdMismatch ?? false;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    let paramBackup: FlashParamBackup | null = null;

    try {
      // ── Step 0: Refuse before touching the FC ────────
      const refusal = flashRefusal(this.protocol, this.transport, firmware, options.method);
      if (refusal) throw new Error(refusal);
      this.checkBoardMatches(firmware, options);
      const method: ResolvedMethod = options.method === "auto"
        ? (firmware.bootloaderApp ? "px4-serial" : "absolute-auto")
        : options.method;

      // ── Step 1: Back up parameters (persisted before the reboot) ──
      if (options.backupParams && this.protocol?.isConnected) {
        onProgress({ phase: "backup", percent: 1, message: "Backing up parameters..." });
        let params;
        try {
          params = await this.protocol.getAllParameters();
        } catch (err) {
          if (!(err instanceof ParamDownloadIncompleteError)) {
            throw new Error(`Parameter backup failed (${err instanceof Error ? err.message : String(err)}). Not flashing.`);
          }
          // A partial backup restores a partial configuration. Flash only
          // when the operator explicitly accepts that.
          const accepted = typeof globalThis.confirm === "function" && globalThis.confirm(
            `Backup incomplete ${err.received}/${err.total}: ${err.total - err.received} parameters were not received. ` +
            "Flash anyway with this partial backup?",
          );
          if (!accepted) {
            throw new Error(`Parameter backup incomplete (${err.received}/${err.total}). Not flashing.`);
          }
          this.log("warning", `operator accepted an incomplete backup (${err.received}/${err.total})`);
          params = err.params;
        }
        paramBackup = await saveFlashParamBackup(options.backupBoard ?? String(firmware.boardId ?? "unknown"), params);
        onProgress({
          phase: "backup",
          percent: 5,
          message: `Saved ${paramBackup.params.length} parameters to browser storage and a .param download`,
        });
        this.log("info", `backed up ${paramBackup.params.length} parameters as ${paramBackup.key}`);
      }

      checkAbort(signal);

      // ── Step 2: Reboot to bootloader ─────────────────
      if (this.protocol?.isConnected) {
        onProgress({ phase: "rebooting", percent: 5, message: "Sending reboot-to-bootloader command..." });
        await this.rebootToBootloader();
        onProgress({ phase: "rebooting", percent: 6, message: "FC is rebooting into bootloader mode..." });
        this.log("info", "sent reboot-to-bootloader");
      }

      checkAbort(signal);

      // ── Step 3: Wait for and detect bootloader ───────
      // Capture (without disconnecting) the app's serial port so we can probe
      // it on a bridge board; then disconnect the live transport so the port
      // can be reopened with bootloader settings.
      const existingPort = this.releaseTransportPort();
      if (existingPort) {
        await this.transport!.disconnect();
      }

      this.flasher = await this.waitForBootloader(method, existingPort, onProgress, signal);

      checkAbort(signal);

      // ── Step 4: Flash firmware ───────────────────────
      // The flasher erases, writes, verifies (while still in the bootloader),
      // then leaves the bootloader / reboots into the new firmware as its
      // final step. Verification cannot happen after that reboot — the
      // bootloader is gone and the device disconnects — so it lives inside
      // flash(), gated by the verify option, not in a separate pass here.
      await this.flasher.flash(firmware, onProgress, signal, this.onLog ?? undefined, { verify: options.verify });

      checkAbort(signal);

      onProgress({
        phase: "done",
        percent: 100,
        message: paramBackup
          ? `Firmware update complete. ${paramBackup.params.length} parameters were saved before flashing; reconnect to review and restore them.`
          : "Firmware update complete!",
      });
      this.log("info", "firmware update complete");
      return { paramBackup };
    } catch (err) {
      if (signal.aborted) {
        onProgress({ phase: "error", percent: 0, message: "Flash aborted by user" });
      } else {
        const message = err instanceof Error ? err.message : "Unknown flash error";
        onProgress({ phase: "error", percent: 0, message });
        this.log("error", message);
      }
      throw err;
    } finally {
      if (this.flasher) {
        await this.flasher.dispose().catch(() => {});
        this.flasher = null;
      }
      this.pendingSerialResolver = null;
      this.pendingUsbResolver = null;
    }
  }

  /** Cancel an in-progress flash operation. */
  abort(): void {
    this.abortController?.abort();
    this.flasher?.abort();
  }

  /**
   * Resolve a pending "select device" action from a user click. Runs the
   * browser device picker INSIDE the gesture (the browser requires this) and
   * feeds the chosen device back into the paused recovery flow. Rejects if the
   * user cancels the picker, leaving the action pending so the button can be
   * clicked again.
   */
  async selectBootloaderManually(action: FlashUserAction): Promise<void> {
    if (action.kind === "select-bootloader") {
      if (!this.pendingSerialResolver) return;
      const filters = action.filters ? toSerialFilters(action.filters) : undefined;
      const port = await navigator.serial.requestPort(filters ? { filters } : undefined);
      this.pendingSerialResolver(port);
      return;
    }
    if (action.kind === "select-dfu") {
      if (!this.pendingUsbResolver) return;
      const device = await STM32DfuFlasher.requestDevice();
      this.pendingUsbResolver(device);
      return;
    }
  }

  // ── Workflow Steps ─────────────────────────────────────

  /**
   * Refuse an image built for a different board than the connected FC
   * reports: AUTOPILOT_VERSION board id against the image's board id, and
   * the MSP board name against the selected target.
   */
  private checkBoardMatches(firmware: ParsedFirmware, options: FlashOptions): void {
    if (!this.protocol?.isConnected || this.allowBoardIdMismatch) return;
    const info = this.protocol.getVehicleInfo();
    if (!info) return;
    if (info.boardId !== undefined && firmware.boardId !== undefined && info.boardId !== firmware.boardId) {
      throw new Error(
        `Board ID mismatch: the firmware is for board id ${firmware.boardId}, but the connected flight controller reports ${info.boardId}. Pick the firmware that matches your board.`,
      );
    }
    const target = options.expectedBoardTarget;
    if (target && info.boardTargetName && info.boardTargetName.toLowerCase() !== target.toLowerCase()) {
      throw new Error(
        `The connected flight controller reports board ${info.boardTargetName}, but the selected target is ${target}. Pick the matching target, or flash the file as a custom file if you are sure.`,
      );
    }
  }

  private async rebootToBootloader(): Promise<void> {
    if (!this.protocol) return;
    try {
      await this.protocol.rebootToBootloader();
    } catch {
      // FC may disconnect immediately — that's expected
    }
  }

  /** Get the SerialPort from the transport (if serial-based), else null. */
  private releaseTransportPort(): SerialPort | null {
    if (this.transport && "getPort" in this.transport) {
      return (this.transport as { getPort(): SerialPort | null }).getPort();
    }
    return null;
  }

  /**
   * Acquire a flasher bound to the board's bootloader, surviving native-USB
   * re-enumeration.
   */
  private async waitForBootloader(
    method: ResolvedMethod,
    existingPort: SerialPort | null,
    onProgress: FlashProgressCallback,
    signal: AbortSignal,
  ): Promise<FirmwareFlasher> {
    if (method === "px4-serial") {
      return waitForPx4Bootloader(existingPort, onProgress, signal, {
        allowBoardIdMismatch: this.allowBoardIdMismatch,
        onLog: this.onLog ?? undefined,
        log: (level, message) => this.log(level, message),
        selectSerial: (action, progress, sig) => this.waitForManualSerialSelect(action, progress, sig),
      });
    }

    // Give the FC a moment to begin rebooting before we probe / poll.
    await delay(1500);

    // ── DFU (native-USB boards): already-permitted devices need no gesture ──
    if (method !== "st-rom-serial" && STM32DfuFlasher.isSupported()) {
      const dfu = await pollForDfu(onProgress, signal);
      if (dfu) {
        onProgress({ phase: "bootloader_init", percent: 9, message: `DFU bootloader detected: ${dfu.label}` });
        this.log("info", `DFU bootloader detected: ${dfu.label}`);
        return new STM32DfuFlasher(dfu.device);
      }
    }

    // ── ST ROM bootloader on a USB-UART bridge keeps the same port ──
    if (method !== "dfu" && existingPort && await probeStRomSync(existingPort)) {
      onProgress({ phase: "bootloader_init", percent: 9, message: "ST ROM bootloader detected" });
      this.log("info", "ST ROM bootloader detected on existing port (bridge board)");
      return new STM32SerialFlasher(existingPort);
    }

    // ── Fallback: ask the user to pick the device (a real click) ──
    if (method === "st-rom-serial") {
      const port = await this.waitForManualSerialSelect({ kind: "select-bootloader" }, onProgress, signal);
      return new STM32SerialFlasher(port);
    }
    const device = await this.waitForManualUsbSelect({ kind: "select-dfu" }, onProgress, signal);
    return new STM32DfuFlasher(device);
  }


  /** Block until the user picks a serial bootloader device (a real click). */
  private waitForManualSerialSelect(
    action: FlashUserAction,
    onProgress: FlashProgressCallback,
    signal: AbortSignal,
  ): Promise<SerialPort> {
    onProgress({
      phase: "bootloader_wait",
      percent: 9,
      message: "Your board rebooted into its bootloader as a new USB device. Click to select it.",
      action,
    });
    this.log("warning", "auto-detect failed — awaiting manual bootloader selection");
    const { promise, resolve, reject } = Promise.withResolvers<SerialPort>();
    const onAbort = () => { this.pendingSerialResolver = null; reject(new Error("Flash aborted by user")); };
    if (signal.aborted) { onAbort(); return promise; }
    signal.addEventListener("abort", onAbort, { once: true });
    this.pendingSerialResolver = (port) => {
      signal.removeEventListener("abort", onAbort);
      this.pendingSerialResolver = null;
      resolve(port);
    };
    return promise;
  }

  /** Block until the user picks a DFU device (a real click). */
  private waitForManualUsbSelect(
    action: FlashUserAction,
    onProgress: FlashProgressCallback,
    signal: AbortSignal,
  ): Promise<USBDevice> {
    onProgress({
      phase: "bootloader_wait",
      percent: 9,
      message: "DFU device not detected automatically. Click to select it (hold BOOT, replug USB).",
      action,
    });
    this.log("warning", "auto-detect failed — awaiting manual DFU selection");
    const { promise, resolve, reject } = Promise.withResolvers<USBDevice>();
    const onAbort = () => { this.pendingUsbResolver = null; reject(new Error("Flash aborted by user")); };
    if (signal.aborted) { onAbort(); return promise; }
    signal.addEventListener("abort", onAbort, { once: true });
    this.pendingUsbResolver = (device) => {
      signal.removeEventListener("abort", onAbort);
      this.pendingUsbResolver = null;
      resolve(device);
    };
    return promise;
  }

  // ── Helpers ────────────────────────────────────────────

  private log(level: "debug" | "info" | "warning" | "error", message: string): void {
    this.onLog?.(level, message);
  }

}
