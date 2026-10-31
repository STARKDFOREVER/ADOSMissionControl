/**
 * @module convex/lib/heartbeatBlockFields
 * @description Payload coercion for the heartbeat's structured list and object
 * blocks (manual URLs, plugin inventory, peripherals, linked peers, video legs,
 * CAN buses, camera USB recovery, config errors). A malformed entry is dropped
 * rather than failing the whole heartbeat.
 *
 * @license GPL-3.0-only
 */

import {
  booleanField,
  nullableBoolean,
  nullableNumber,
  nullableString,
  numberField,
  stringField,
} from "./heartbeatPrimitives";

export interface ManualConnectionUrlsPayload {
  mavlinkTcp?: string | null;
  mavlinkWs?: string | null;
  mavlinkWsAuthenticated?: string | null;
  videoViewer?: string | null;
  videoWhep?: string | null;
}

// Build the typed manual-connection-URLs block from the agent body. Each
// member is forwarded only when it is a string or explicit null so the
// strict pushStatus validator never rejects a malformed entry and fails the
// whole heartbeat. Returns undefined when the agent omits the block.
export function manualConnectionUrlsField(
  body: Record<string, unknown>,
): ManualConnectionUrlsPayload | undefined {
  const raw = body.manualConnectionUrls;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const out: ManualConnectionUrlsPayload = {};
  const mavlinkTcp = nullableString(row.mavlinkTcp);
  const mavlinkWs = nullableString(row.mavlinkWs);
  const mavlinkWsAuthenticated = nullableString(row.mavlinkWsAuthenticated);
  const videoViewer = nullableString(row.videoViewer);
  const videoWhep = nullableString(row.videoWhep);
  if (mavlinkTcp !== undefined) out.mavlinkTcp = mavlinkTcp;
  if (mavlinkWs !== undefined) out.mavlinkWs = mavlinkWs;
  if (mavlinkWsAuthenticated !== undefined)
    out.mavlinkWsAuthenticated = mavlinkWsAuthenticated;
  if (videoViewer !== undefined) out.videoViewer = videoViewer;
  if (videoWhep !== undefined) out.videoWhep = videoWhep;
  return out;
}

export interface PluginInventoryEntry {
  plugin_id: string;
  version?: string | null;
  status?: string | null;
}

// Build the plugin-inventory array, dropping any entry that lacks a string
// plugin_id so the strict pushStatus validator accepts the whole block.
// Returns undefined when the agent omits the field.
export function pluginInventoryField(
  body: Record<string, unknown>,
): PluginInventoryEntry[] | undefined {
  const raw = body.pluginInventory;
  if (!Array.isArray(raw)) return undefined;
  const out: PluginInventoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const pluginId = stringField(row, "plugin_id");
    if (!pluginId) continue;
    const entry: PluginInventoryEntry = { plugin_id: pluginId };
    const version = nullableString(row.version);
    const status = nullableString(row.status);
    if (version !== undefined) entry.version = version;
    if (status !== undefined) entry.status = status;
    out.push(entry);
  }
  return out;
}

export interface PeripheralStateEntry {
  id: string;
  connected: boolean;
  last_seen?: number | null;
}

// Build the compact per-peripheral connection-state array (drives the
// connected/disconnected dot on the drone card). Drops any entry missing a
// string id or a boolean connected flag so the strict validator accepts the
// block. Returns undefined when the agent omits the field.
export function peripheralStatesField(
  body: Record<string, unknown>,
): PeripheralStateEntry[] | undefined {
  const raw = body.peripheralStates;
  if (!Array.isArray(raw)) return undefined;
  const out: PeripheralStateEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = stringField(row, "id");
    const connected = booleanField(row, "connected");
    if (!id || connected === undefined) continue;
    const entry: PeripheralStateEntry = { id, connected };
    const lastSeen = nullableNumber(row.last_seen);
    if (lastSeen !== undefined) entry.last_seen = lastSeen;
    out.push(entry);
  }
  return out;
}

export interface LinkedPeerEntry {
  deviceId: string;
  role?: string | null;
  channel?: number | null;
  rssiDbm?: number | null;
  seenAtUnix?: number | null;
}

// Build the linkedPeers[] list a ground station relays. The OSS-twin
// /agent/status route PICKS fields one by one, so this must be forwarded here
// or the mutation never receives it. Entries arrive camelCase already (the
// heartbeat producers emit deviceId/role/channel/rssiDbm/seenAtUnix); an entry
// with no device id, or a non-object, is DROPPED rather than failing the whole
// heartbeat, and each field is coerced to the optional-nullable shape the
// strict inner validator declares. Returns undefined when the agent omits it.
export function linkedPeersField(
  body: Record<string, unknown>,
): LinkedPeerEntry[] | undefined {
  const raw = body.linkedPeers;
  if (!Array.isArray(raw)) return undefined;
  const out: LinkedPeerEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const deviceId = stringField(row, "deviceId");
    if (!deviceId) continue;
    out.push({
      deviceId,
      role: nullableString(row.role),
      channel: nullableNumber(row.channel),
      rssiDbm: nullableNumber(row.rssiDbm),
      seenAtUnix: nullableNumber(row.seenAtUnix),
    });
  }
  // An EMPTY list is a real reading — the node has no linked peers / no
  // video streams / no CAN buses right now — and it must be forwarded as
  // one. Collapsing it to `undefined` translated "nothing here" into "no
  // update", so the LAST NON-EMPTY list persisted in the cloud row
  // forever: a dead radio kept showing its peers.
  return out;
}

export interface VideoStreamEntry {
  id: string;
  role?: string;
  codec?: string;
  live?: boolean;
  whepUrl?: string;
}

// Build the per-leg video-stream list, keeping only entries the strict inner
// validator declares. A leg with no `id` is dropped rather than failing the
// whole heartbeat. Returns undefined when the agent omits the key.
export function videoStreamsField(
  body: Record<string, unknown>,
): VideoStreamEntry[] | undefined {
  const raw = body.videoStreams;
  if (!Array.isArray(raw)) return undefined;
  const out: VideoStreamEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = stringField(row, "id");
    if (!id) continue;
    out.push({
      id,
      role: stringField(row, "role"),
      codec: stringField(row, "codec"),
      live: booleanField(row, "live"),
      whepUrl: stringField(row, "whepUrl"),
    });
  }
  // An EMPTY list is a real reading — the node has no linked peers / no
  // video streams / no CAN buses right now — and it must be forwarded as
  // one. Collapsing it to `undefined` translated "nothing here" into "no
  // update", so the LAST NON-EMPTY list persisted in the cloud row
  // forever: a dead radio kept showing its peers.
  return out;
}

export interface CanBusEntry {
  port: number;
  driver: number;
  bitrate: number;
  protocol: number;
}

// Build the FC CAN-bus table. Every field is required by the inner validator,
// so an entry missing one is dropped rather than rejecting the heartbeat.
export function canBusesField(body: Record<string, unknown>): CanBusEntry[] | undefined {
  const raw = body.canBuses;
  if (!Array.isArray(raw)) return undefined;
  const out: CanBusEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const port = numberField(row, "port");
    const driver = numberField(row, "driver");
    const bitrate = numberField(row, "bitrate");
    const protocol = numberField(row, "protocol");
    if (
      port === undefined ||
      driver === undefined ||
      bitrate === undefined ||
      protocol === undefined
    ) {
      continue;
    }
    out.push({ port, driver, bitrate, protocol });
  }
  // An EMPTY list is a real reading — the node has no linked peers / no
  // video streams / no CAN buses right now — and it must be forwarded as
  // one. Collapsing it to `undefined` translated "nothing here" into "no
  // update", so the LAST NON-EMPTY list persisted in the cloud row
  // forever: a dead radio kept showing its peers.
  return out;
}

export interface CameraUsbRecoveryPayload {
  state?: string | null;
  case?: string | null;
  attempts?: number | null;
  maxAttempts?: number | null;
  cameraPresent?: boolean | null;
  expected?: boolean | null;
  pppsCapable?: boolean | null;
}

// Build the camera USB-recovery block, forwarding only the known fields and
// coercing each to its validator-accepted shape so a malformed agent payload
// cannot fail the whole heartbeat. Returns undefined when the agent omits it.
export function cameraUsbRecoveryField(
  body: Record<string, unknown>,
): CameraUsbRecoveryPayload | undefined {
  const raw = body.cameraUsbRecovery;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const out: CameraUsbRecoveryPayload = {};
  const state = nullableString(row.state);
  const caseValue = nullableString(row.case);
  const attempts = nullableNumber(row.attempts);
  const maxAttempts = nullableNumber(row.maxAttempts);
  const cameraPresent = nullableBoolean(row.cameraPresent);
  const expected = nullableBoolean(row.expected);
  const pppsCapable = nullableBoolean(row.pppsCapable);
  if (state !== undefined) out.state = state;
  if (caseValue !== undefined) out.case = caseValue;
  if (attempts !== undefined) out.attempts = attempts;
  if (maxAttempts !== undefined) out.maxAttempts = maxAttempts;
  if (cameraPresent !== undefined) out.cameraPresent = cameraPresent;
  if (expected !== undefined) out.expected = expected;
  if (pppsCapable !== undefined) out.pppsCapable = pppsCapable;
  return out;
}

export interface ConfigErrorEntry {
  service: string;
  error: string;
}

// Build the per-service config-load-error array, dropping any entry that lacks a
// string service or a string error so the strict pushStatus validator accepts
// the whole block. Returns undefined when the agent omits the field.
export function configErrorsField(
  body: Record<string, unknown>,
): ConfigErrorEntry[] | undefined {
  const raw = body.configErrors;
  if (!Array.isArray(raw)) return undefined;
  const out: ConfigErrorEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const service = stringField(row, "service");
    const error = stringField(row, "error");
    if (!service || !error) continue;
    out.push({ service, error });
  }
  return out;
}
