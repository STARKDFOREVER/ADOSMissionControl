/**
 * @module mock/agent/wifi
 * @description Demo stand-in for the agent's profile-agnostic Wi-Fi client
 * routes (`/api/v1/network/client/*`). The demo agent URL is `mock://demo`,
 * which no browser can fetch, so `network-client` hands these requests here
 * and runs the answer through its normal status/body handling. The state is
 * in memory: a join, disconnect, forget or autoconnect toggle changes what the
 * next status, scan and saved-network reads return, so the whole page flow
 * works in `npm run demo`.
 *
 * Every value is synthetic: generic SSIDs, locally administered BSSIDs
 * (`02:00:00:…`), and the documented demo address range.
 * @license GPL-3.0-only
 */

/** One answered request: the HTTP status and the JSON body the agent sends. */
export interface MockAgentResponse {
  status: number;
  body: unknown;
}

interface NearbyNetwork {
  ssid: string;
  bssid: string;
  /** nmcli signal strength, 0–100. */
  signal: number;
  /** nmcli security label; empty for an open network. */
  security: string;
}

interface SavedProfile {
  name: string;
  type: string;
  device: string | null;
  autoconnect: boolean;
}

interface WifiState {
  connectedSsid: string | null;
  saved: SavedProfile[];
}

/** What the demo node's radio hears, strongest first. */
const NEARBY: readonly NearbyNetwork[] = [
  { ssid: "Field-Ops-5G", bssid: "02:00:00:5e:10:01", signal: 82, security: "WPA2" },
  { ssid: "Hangar-2G", bssid: "02:00:00:5e:10:02", signal: 64, security: "WPA2" },
  { ssid: "Survey-Van", bssid: "02:00:00:5e:10:03", signal: 47, security: "WPA3" },
  { ssid: "Bench-Open", bssid: "02:00:00:5e:10:04", signal: 29, security: "" },
];

const STATION_IFACE = "wlan0";
const STATION_IP = "192.168.7.1";
const WIFI_TYPE = "802-11-wireless";
const ROUTE = "/api/v1/network/client";

function initialState(): WifiState {
  return {
    connectedSsid: "Field-Ops-5G",
    saved: [
      { name: "Field-Ops-5G", type: WIFI_TYPE, device: STATION_IFACE, autoconnect: true },
      { name: "Hangar-2G", type: WIFI_TYPE, device: null, autoconnect: false },
    ],
  };
}

let state: WifiState = initialState();

/** Restore the boot state (tests, and a fresh demo session). */
export function resetMockWifi(): void {
  state = initialState();
}

function ok(body: unknown): MockAgentResponse {
  return { status: 200, body };
}

function fail(status: number, message: string): MockAgentResponse {
  return { status, body: { detail: message } };
}

function parseBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "string" || body.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function statusBody(): Record<string, unknown> {
  const net = NEARBY.find((n) => n.ssid === state.connectedSsid);
  if (!state.connectedSsid) {
    return {
      connected: false,
      ssid: null,
      bssid: null,
      signal: null,
      ip: null,
      gateway: null,
      security: null,
    };
  }
  return {
    connected: true,
    ssid: state.connectedSsid,
    bssid: net?.bssid ?? null,
    signal: net?.signal ?? null,
    ip: STATION_IP,
    gateway: null,
    security: net?.security || null,
  };
}

function scanBody(): Record<string, unknown> {
  return {
    networks: [...NEARBY]
      .sort((a, b) => b.signal - a.signal)
      .map((n) => ({ ...n, in_use: n.ssid === state.connectedSsid })),
  };
}

function setStationDevice(name: string | null): void {
  for (const p of state.saved) p.device = p.name === name ? STATION_IFACE : null;
}

function join(body: Record<string, unknown>): MockAgentResponse {
  const ssid = typeof body.ssid === "string" ? body.ssid.trim() : "";
  if (!ssid) return fail(422, "ssid is required");
  const net = NEARBY.find((n) => n.ssid === ssid);
  if (!net) return ok({ joined: false, error: `No network with SSID '${ssid}' found.` });
  const known = state.saved.some((p) => p.name === ssid);
  const hasPassphrase = typeof body.passphrase === "string" && body.passphrase.length > 0;
  if (net.security && !known && !hasPassphrase) {
    return ok({ joined: false, error: "Secrets were required, but not provided." });
  }
  if (!known) {
    state.saved.push({ name: ssid, type: WIFI_TYPE, device: null, autoconnect: true });
  }
  state.connectedSsid = ssid;
  setStationDevice(ssid);
  return ok({ joined: true, ip: STATION_IP, gateway: null });
}

function leave(): MockAgentResponse {
  const previous = state.connectedSsid;
  state.connectedSsid = null;
  setStationDevice(null);
  return ok({ left: previous !== null, previous_ssid: previous });
}

function forget(name: string): MockAgentResponse {
  const before = state.saved.length;
  state.saved = state.saved.filter((p) => p.name !== name);
  if (state.saved.length === before) return fail(404, `No saved network named '${name}'.`);
  if (state.connectedSsid === name) state.connectedSsid = null;
  return ok({ forgotten: name });
}

function setAutoconnect(name: string, body: Record<string, unknown>): MockAgentResponse {
  const profile = state.saved.find((p) => p.name === name);
  if (!profile) return fail(404, `No saved network named '${name}'.`);
  if (typeof body.enabled !== "boolean") return fail(422, "enabled must be a boolean");
  profile.autoconnect = body.enabled;
  return ok({ name, autoconnect: profile.autoconnect });
}

/**
 * Answer one Wi-Fi client request the way the agent does.
 * @param method HTTP method (`GET` when the caller set none).
 * @param path Request path, e.g. `/api/v1/network/client/status`.
 * @param body The request's JSON string body, if any.
 */
export function mockWifiRoute(method: string, path: string, body?: unknown): MockAgentResponse {
  const verb = method.toUpperCase();
  const args = parseBody(body);
  if (path === ROUTE && verb === "DELETE") return leave();
  if (path === `${ROUTE}/status` && verb === "GET") return ok(statusBody());
  if (path === `${ROUTE}/scan` && verb === "GET") return ok(scanBody());
  if (path === `${ROUTE}/configured` && verb === "GET") {
    return ok({ connections: state.saved.map((p) => ({ ...p })) });
  }
  if (path === `${ROUTE}/join` && verb === "PUT") return join(args);
  const configured = /^\/api\/v1\/network\/client\/configured\/([^/]+)(\/autoconnect)?$/.exec(path);
  if (configured) {
    const name = decodeURIComponent(configured[1]);
    if (configured[2] && verb === "PUT") return setAutoconnect(name, args);
    if (!configured[2] && verb === "DELETE") return forget(name);
  }
  return fail(404, "Not Found");
}
