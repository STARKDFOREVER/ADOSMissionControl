/**
 * @module agent/node-flags
 * @description Plain boolean flags the agent's capabilities payload carries
 * about the node itself: whether it runs against a simulator and which
 * optional services (GNSS, LoRa) are fitted. Each is undefined on an agent
 * that predates it, which a reader treats as unknown, never as absent.
 * @license GPL-3.0-only
 */

export interface NodeFlags {
  /** True when the node runs against a simulator (`simulation.enabled` in the
   * agent config). */
  sim?: boolean;
  /** True when the node runs a GNSS service with a fitted receiver (the
   * agent's `gnss` capability flag). */
  gnss?: boolean;
  /** True when the node runs a LoRa lane with a fitted radio (the agent's
   * `lora` capability flag). */
  lora?: boolean;
}
