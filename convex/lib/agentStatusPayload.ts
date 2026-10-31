/**
 * @module convex/lib/agentStatusPayload
 * @description Request shaping for the agent-facing HTTP routes: the bounded
 * JSON body reader, and the `/agent/status` heartbeat filter.
 *
 * The heartbeat filter is driven by `pushStatusArgs`, the one object the
 * `pushStatus` validator is built from:
 *
 * - A root key `pushStatus` does not declare is dropped and reported back as
 *   `unknownFields`. A Convex args validator rejects the WHOLE call on one
 *   undeclared key, so forwarding it would take every node on a newer agent
 *   build dark until a deploy caught up.
 * - Every structured block goes through its coercer in `heartbeatStatusFields` /
 *   `heartbeatBlockFields`
 *   (snake_case remapped, undeclared inner keys dropped, malformed entries
 *   dropped). A block that cannot be coerced is removed.
 * - Every scalar is checked against its declared validator and dropped when it
 *   does not fit (an agent's `temperature: null` against a number column, a
 *   string where a boolean is declared), so one bad value never fails the tick.
 *
 * A new declared key is forwarded the moment it is declared; there is no
 * per-field pick list to fall out of step.
 *
 * Pure functions with no Convex runtime dependency, so they are unit-testable.
 *
 * @license GPL-3.0-only
 */

import { pushStatusArgs } from "./pushStatusArgs";
import { jsonHeaders, numberArrayField, stringArrayField } from "./heartbeatPrimitives";
import { crsfField, radioField, serviceListField } from "./heartbeatStatusFields";
import {
  cameraUsbRecoveryField,
  canBusesField,
  configErrorsField,
  linkedPeersField,
  manualConnectionUrlsField,
  peripheralStatesField,
  pluginInventoryField,
  videoStreamsField,
} from "./heartbeatBlockFields";

/**
 * Upper bound on a JSON control/heartbeat body. A real heartbeat is low tens
 * of KB; the cap stops a buggy or compromised-but-key-valid agent from
 * pushing an oversized blob every few seconds. The binary log-window route
 * has its own cap.
 */
export const MAX_JSON_BODY_BYTES = 512 * 1024;

/** Read a JSON object body with a size bound, or return the Response to send. */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  // A Content-Length header (when present) is a cheap early reject; the
  // actual byte length is the authoritative check for chunked bodies.
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "request body too large" }), {
      status: 413,
      headers: jsonHeaders,
    });
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
  // Byte length (not string length) so multi-byte payloads are bounded too.
  if (new TextEncoder().encode(text).length > MAX_JSON_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "request body too large" }), {
      status: 413,
      headers: jsonHeaders,
    });
  }
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return new Response(JSON.stringify({ error: "JSON object required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }
    return body as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
}

type Body = Record<string, unknown>;

function plainObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Structured heartbeat blocks and the coercer each one goes through. */
const BLOCK_COERCERS: Readonly<Record<string, (body: Body) => unknown>> = {
  radio: (body) => radioField(body, "radio"),
  crsf: (body) => crsfField(body, "crsf"),
  configErrors: configErrorsField,
  linkedPeers: linkedPeersField,
  videoStreams: videoStreamsField,
  canBuses: canBusesField,
  cameraUsbRecovery: cameraUsbRecoveryField,
  pluginInventory: pluginInventoryField,
  peripheralStates: peripheralStatesField,
  manualConnectionUrls: manualConnectionUrlsField,
  services: (body) => serviceListField(body, "services"),
  failedSteps: (body) => stringArrayField(body, "failedSteps"),
  cpuHistory: (body) => numberArrayField(body, "cpuHistory"),
  memoryHistory: (body) => numberArrayField(body, "memoryHistory"),
  // Free-form objects: forwarded verbatim when they are objects.
  macStability: (body) => plainObject(body.macStability),
  managementLink: (body) => plainObject(body.managementLink),
  wifiPowersave: (body) => plainObject(body.wifiPowersave),
  // Opaque per-plugin telemetry map (`v.record`): anything else fails the call.
  pluginState: (body) => plainObject(body.pluginState),
  // The peripheral manifest; `pushStatus` derives the LCD pill from it.
  peripherals: (body) => (Array.isArray(body.peripherals) ? body.peripherals : undefined),
};

interface ValidatorShape {
  kind?: string;
  value?: unknown;
  members?: ValidatorShape[];
}

/**
 * Whether `value` satisfies a scalar validator. Returns true for kinds this
 * filter does not inspect (`any`, objects, arrays): those are either coerced
 * above or accepted as declared.
 */
function fitsValidator(validator: ValidatorShape, value: unknown): boolean {
  switch (validator.kind) {
    case "string":
      return typeof value === "string";
    case "float64":
      return typeof value === "number";
    case "int64":
      return typeof value === "bigint";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "literal":
      return value === validator.value;
    case "union":
      return (validator.members ?? []).some((member) => fitsValidator(member, value));
    default:
      return true;
  }
}

/** Every root key `pushStatus` declares. */
export const PUSH_STATUS_KEYS: ReadonlySet<string> = new Set(Object.keys(pushStatusArgs));

/** Keys an agent sends that are deliberately not status: never reported. */
export const STRIPPED_KEYS: ReadonlySet<string> = new Set(["apiKey", "agentVersion"]);

export interface StatusPayload {
  /** The arguments to hand to `pushStatus`. */
  payload: Record<string, unknown>;
  /** Root keys this deployment does not declare, sorted. */
  unknownFields: string[];
}

/**
 * Shape a heartbeat body into `pushStatus` arguments. The caller has already
 * checked the device credentials and the required identity fields.
 */
export function buildStatusPayload(body: Body): StatusPayload {
  const payload: Record<string, unknown> = {};
  const unknownFields: string[] = [];
  const declared = pushStatusArgs as unknown as Record<string, ValidatorShape>;
  for (const [key, value] of Object.entries(body)) {
    if (STRIPPED_KEYS.has(key)) continue;
    if (!PUSH_STATUS_KEYS.has(key)) {
      unknownFields.push(key);
      continue;
    }
    const coerce = BLOCK_COERCERS[key];
    const shaped = coerce ? coerce(body) : value;
    if (shaped === undefined) continue;
    if (!coerce && !fitsValidator(declared[key], shaped)) continue;
    payload[key] = shaped;
  }
  return { payload, unknownFields: unknownFields.sort() };
}
