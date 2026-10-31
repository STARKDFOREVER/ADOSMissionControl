/**
 * @module AgentSchemas
 * @description zod schemas for the ADOS Drone Agent REST API boundary.
 * Used as optional runtime validators on client.request() calls so the
 * GCS catches shape drift instead of crashing deep inside a store.
 *
 * Schemas are intentionally permissive at the seam: unknown fields pass
 * through, optional fields are explicitly optional, and unions accept the
 * older legacy shapes the agent has shipped over time.
 *
 * Per-domain schemas live in this directory (heartbeat, capabilities,
 * navigation, setup, pairing, peripherals, meshnet, command, battery).
 *
 * @license GPL-3.0-only
 */

export * from "./heartbeat";
export * from "./capabilities";
export * from "./navigation";
export * from "./setup";
export * from "./pairing";
export * from "./peripherals";
export * from "./meshnet";
export * from "./command";
export * from "./battery";
