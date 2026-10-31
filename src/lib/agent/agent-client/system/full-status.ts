/**
 * @module agent/agent-client/system
 * @description Consolidated /api/status/full fetch and liveness normalisation.
 * @license GPL-3.0-only
 */

import type { z } from "zod";
import type { StatusFull } from "../../agent-api.generated";
import type { FcSource, LanStatusFull, SnakeFcLiveness } from "../../types";
import { FullStatusResponseSchema } from "../../schemas";
import { agentRequest, type RequestContext } from "../transport";
import { agentSupports, fetchVersionInfo } from "../version-cache";

/**
 * The agent's native status front emits the FC-liveness detail in camelCase
 * (`transportOpen` / `mavlinkAlive` / `heartbeatAgeS` / `fcSource` / `fcLinkHint`,
 * "like the heartbeat"), while the rest of the GCS reads these as snake_case off
 * `AgentStatus` / `LanStatusFull`. Bridge the two at the LAN boundary: when
 * a snake field is absent but its camelCase sibling is present, copy it across
 * (snake wins for back-compat). Without this the gated MAVLink truth + the
 * FC-link diagnostic hint silently never reach the LAN-direct render path, so a
 * port-open-but-silent link reads as a bare disconnect with no remediation.
 * Returns just the five fields so callers spread it over the source object.
 */
export function snakeLivenessPatch(obj: SnakeFcLiveness): SnakeFcLiveness {
  const raw: Record<string, unknown> = { ...obj };
  const bool = (snake: boolean | undefined, camel: unknown) =>
    typeof snake === "boolean"
      ? snake
      : typeof camel === "boolean"
        ? camel
        : snake;
  const str = (snake: string | undefined, camel: unknown) =>
    typeof snake === "string" ? snake : typeof camel === "string" ? camel : snake;
  const numOrNull = (
    snake: number | null | undefined,
    camel: unknown,
  ): number | null | undefined =>
    snake !== undefined
      ? snake
      : camel === null || typeof camel === "number"
        ? (camel as number | null)
        : snake;
  return {
    transport_open: bool(obj.transport_open, raw.transportOpen),
    mavlink_alive: bool(obj.mavlink_alive, raw.mavlinkAlive),
    heartbeat_age_s: numOrNull(obj.heartbeat_age_s, raw.heartbeatAgeS),
    fc_source: str(obj.fc_source, raw.fcSource) as FcSource | undefined,
    fc_link_hint: str(obj.fc_link_hint, raw.fcLinkHint),
    // The native front emits the FC firmware family in camelCase
    // (`fcFirmware`); bridge it to the snake `fc_firmware` the GCS reads so a
    // LAN-direct ArduPilot/PX4 node names its firmware the same as the cloud.
    fc_firmware: str(obj.fc_firmware, raw.fcFirmware),
    // The protocol family and the agent's own connected-or-reachable verdict.
    // Without these a healthy MSP flight controller (which never emits the
    // MAVLink heartbeat `fc_connected` gates on) reads as absent on the
    // LAN-direct path, and the FC surfaces claim "no flight controller".
    fc_variant: str(obj.fc_variant, raw.fcVariant),
    fc_reachable: bool(obj.fc_reachable, raw.fcReachable),
    // Telemetry flows but GCS commands to the FC are dropped.
    fc_command_down_gated: bool(
      obj.fc_command_down_gated,
      raw.fcCommandDownGated,
    ),
  };
}

/** Bridge the camelCase liveness on a `/api/status/full` response into the
 * snake_case the GCS reads, and read its `unknown` blocks through the
 * `LanStatusFull` narrowing. Exported for the LAN boundary + tests. */
export function normalizeFullStatusLiveness(full: StatusFull): LanStatusFull {
  const lan = full as LanStatusFull;
  return { ...lan, ...snakeLivenessPatch(lan) };
}

/**
 * Fetch all status data in a single request (agent v0.3.19+).
 * Falls back to null on older agents that don't have this endpoint.
 *
 * Uses /api/version capability negotiation when available so we
 * skip the request entirely (and don't burn a 404 round-trip)
 * against an agent that hasn't advertised status.full.
 */
export async function getFullStatus(
  ctx: RequestContext,
): Promise<LanStatusFull | null> {
  const info = await fetchVersionInfo(ctx);
  if (info && !agentSupports(info, "status.full")) {
    return null;
  }
  try {
    const full = await agentRequest<StatusFull>(ctx, "/api/status/full", {
      // The schema checks the subset the GCS depends on; the generated type
      // is the wire contract.
      schema: FullStatusResponseSchema as unknown as z.ZodType<StatusFull>,
      allowSchemaFallback: true,
    });
    return normalizeFullStatusLiveness(full);
  } catch (err) {
    // A 404 means the agent predates the endpoint; anything else (timeout,
    // relay 504, network) is transient and MUST NOT be read as unsupported —
    // latching on it permanently quadruples poll traffic for the connection's
    // life.
    if (err instanceof Error && /Agent API 404/.test(err.message)) return null;
    throw err;
  }
}
