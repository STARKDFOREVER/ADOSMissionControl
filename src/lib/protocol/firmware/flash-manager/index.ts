/**
 * Firmware flash orchestration layer.
 *
 * Coordinates the full flash workflow: preflight refusals -> parameter
 * backup -> reboot to bootloader -> detect bootloader -> erase -> flash ->
 * verify -> reboot. Bridges the protocol layer with the low-level PX4-protocol
 * bootloader, STM32 USB DFU and STM32 ROM (UART) flashers.
 *
 * Which flasher runs follows from the image:
 *   - an application image (.apj / .px4, `bootloaderApp`) goes only through
 *     the PX4-protocol bootloader, which the PX4 and ArduPilot USB
 *     bootloaders both speak, and which writes it at its own app offset;
 *   - an absolute image (.hex, `_with_bl.hex`) goes through USB DFU or the ST
 *     ROM bootloader (UART, BOOT0).
 *
 * Flashing is refused unless the flight controller is attached to this
 * browser over a local USB serial link: a reboot-to-bootloader sent over a
 * network link would strand the remote FC in a bootloader nobody can reach.
 *
 * Native-USB flight controllers re-enumerate as a different USB device when
 * they drop into their bootloader. A USB-UART-bridge board keeps the same
 * port handle. The bootloader-acquisition step handles both: it probes the
 * existing handle first (bridge fast path), then waits for a
 * freshly-enumerated bootloader device (native USB), then falls back to a
 * user-gesture device picker.
 *
 * @module protocol/firmware/flash-manager
 */


export { FlashManager } from "./manager";
export { USB_REQUIRED_MESSAGE, flashRefusal, type FlashOutcome } from "./refusal";
