/**
 * @module agent/agent-client/system
 * @description Agent status, services, system resources and logs.
 * @license GPL-3.0-only
 */

import type { z } from "zod";
import { normalizeServiceInfo } from "../../service-state";
import type { AgentStatus, LogEntry, ServiceInfo, SystemResources } from "../../types";
import {
  AgentStatusSchema,
  ServicesResponseSchema,
  SystemResourcesRawSchema,
} from "../../schemas";
import { agentRequest, type RequestContext } from "../transport";
import { legacyLogEntry } from "../logging-wire";
import { snakeLivenessPatch } from "./full-status";

/** A finite number, or undefined when the field is absent or unparseable.
 * `Number(undefined ?? 0)` would report a missing reading as 0, which reads on
 * a gauge as "idle" or "empty" instead of "not reported". */
function optionalNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Coerce a raw `/api/system` (or partial consolidated `/api/status/full`)
 * response into the canonical `SystemResources` shape. A reading the agent
 * did not send stays undefined so the gauge renders it as unknown.
 *
 * The agent surfaces temperature in two shapes: `{ temperature: 45.2 }`
 * (consolidated endpoint) or `{ temperatures: { cpu_thermal: 45.2 } }`
 * (per-domain endpoint). Both are normalised to the flat `temperature`
 * field; falls back to `null` when neither is present.
 */
export function normaliseSystemResources(
  res: Record<string, unknown>,
): SystemResources {
  let temperature: number | null = null;
  if (res.temperature != null) {
    temperature = Number(res.temperature);
  } else if (res.temperatures && typeof res.temperatures === "object") {
    const temps = res.temperatures as Record<string, number>;
    temperature = temps.cpu_thermal ?? Object.values(temps)[0] ?? null;
  }
  // Utilisation and capacity readings preserve absence: a node that reported
  // no figure is unknown, not idle and not empty. The swap and memory-detail
  // fields keep their documented 0 default, where 0 is a real reading (no swap
  // configured, no cache held) rather than a stand-in for a missing one.
  return {
    cpu_percent: optionalNumber(res.cpu_percent),
    memory_percent: optionalNumber(res.memory_percent),
    memory_used_mb: optionalNumber(res.memory_used_mb),
    memory_total_mb: optionalNumber(res.memory_total_mb),
    memory_available_mb: optionalNumber(res.memory_available_mb),
    memory_cache_mb: optionalNumber(res.memory_cache_mb),
    swap_total_mb: optionalNumber(res.swap_total_mb),
    swap_used_mb: optionalNumber(res.swap_used_mb),
    swap_percent: optionalNumber(res.swap_percent),
    disk_percent: optionalNumber(res.disk_percent),
    disk_used_gb: optionalNumber(res.disk_used_gb),
    disk_total_gb: optionalNumber(res.disk_total_gb),
    temperature,
  };
}

export async function getStatus(ctx: RequestContext): Promise<AgentStatus> {
  const status = await agentRequest<AgentStatus>(ctx, "/api/status", {
    schema: AgentStatusSchema as z.ZodType<AgentStatus>,
    allowSchemaFallback: true,
  });
  // The non-full /api/status route emits the FC-liveness fields in camelCase
  // too, so the initial-connect render + the getFullStatus-null fallback carry
  // the gated truth + hint instead of degrading to a bare fc_connected.
  return { ...status, ...snakeLivenessPatch(status) };
}

/** Per-service rows. A metric the agent does not send (the native front sends
 * no CPU, uptime or transition stamp) stays null so the table shows "—". */
export async function getServices(ctx: RequestContext): Promise<ServiceInfo[]> {
  const svcRes = await agentRequest<
    Array<Record<string, unknown>> | { services: Array<Record<string, unknown>> }
  >(ctx, "/api/services", {
    schema: ServicesResponseSchema as z.ZodType<
      Array<Record<string, unknown>> | { services: Array<Record<string, unknown>> }
    >,
    allowSchemaFallback: true,
  });
  const list = Array.isArray(svcRes) ? svcRes : (svcRes.services ?? []);
  return list.map((s) => normalizeServiceInfo(s));
}

export async function getSystemResources(
  ctx: RequestContext,
): Promise<SystemResources> {
  const res = await agentRequest<Record<string, unknown>>(ctx, "/api/system", {
    schema: SystemResourcesRawSchema as z.ZodType<Record<string, unknown>>,
    allowSchemaFallback: true,
  });
  return normaliseSystemResources(res);
}

/** Recent log entries, oldest first, in the viewer's `LogEntry` shape. The
 * agent answers newest first with an upper-case level and a `logger` field, so
 * each entry goes through the same normaliser the cloud-relayed read uses. The
 * store names the warning level `warn`. */
export async function getLogs(
  ctx: RequestContext,
  params?: { level?: string; limit?: number },
): Promise<LogEntry[]> {
  const qs = new URLSearchParams();
  if (params?.level) qs.set("level", params.level === "warning" ? "warn" : params.level);
  if (params?.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  const res = await agentRequest<unknown[] | { entries?: unknown[] }>(
    ctx,
    `/api/logs${query ? `?${query}` : ""}`,
  );
  const entries = Array.isArray(res) ? res : (res.entries ?? []);
  return [...entries].reverse().map((raw) => legacyLogEntry(raw));
}
