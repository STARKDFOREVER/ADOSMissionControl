/**
 * MSP (MultiWii Serial Protocol) adapter for Altnautica Command GCS.
 *
 * Thin composition class that implements `DroneProtocol` by delegating to:
 * - msp-adapter-telemetry.ts (telemetry dispatch)
 * - msp-adapter-commands.ts (commands)
 * - msp-adapter-params.ts (virtual parameter system)
 * - mavlink-adapter-callbacks.ts (shared callback store)
 *
 * @module protocol/msp-adapter
 */

export { MSPAdapter } from './adapter'
