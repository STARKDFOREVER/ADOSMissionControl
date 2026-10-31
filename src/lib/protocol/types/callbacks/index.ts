/**
 * Telemetry callback type aliases for the protocol abstraction layer.
 *
 * Shapes are kept compatible with the store types (AttitudeData, etc.)
 * so protocol → store bridging is a plain assignment.
 *
 * @module protocol/types/callbacks
 */

export * from './flight';
export * from './sensors';
export * from './traffic-vision';
