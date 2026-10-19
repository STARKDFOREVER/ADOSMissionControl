/**
 * @module mock/ground-station-mesh
 * @description In-memory mesh client for the demo ground station: role read
 * and switch, batman-adv health / neighbours / routes / gateways, the
 * distributed-RX reads for each role, and the receiver pairing window with a
 * fixed synthetic join code. The demo seed installs it through
 * `setDemoMeshApi`, so the Mesh & RX surface drives the real store actions
 * against it instead of fetching the non-HTTP demo agent URL.
 * @license GPL-3.0-only
 */

import type { GroundStationApi } from "@/lib/api/ground-station-api";
import { DEMO_GROUND_STATION } from "@/mock/drones";
import type {
  GroundStationRole,
  MeshGateway,
  MeshGatewayPreferenceUpdate,
  MeshHealth,
  MeshNeighbor,
  MeshRoute,
  PairingApproveResult,
  PairingPendingRequest,
  PairingRevokeResult,
  PairingSnapshot,
  PairingWindow,
  RoleInfo,
  WfbReceiverCombined,
  WfbReceiverRelay,
  WfbReceiverRelays,
  WfbRelayStatus,
} from "@/lib/api/ground-station/types";

/** The demo mesh client's origin; the seed tags the mesh slices with it. */
export const DEMO_MESH_BASE_URL = "mock://demo";

/** The role the demo ground station boots in (one source with its fleet row). */
export const DEMO_GS_ROLE: GroundStationRole = DEMO_GROUND_STATION.role;

/** Fixed six-digit join code every demo pairing window shows. */
export const DEMO_JOIN_CODE = "135790";

const SUPPORTED_ROLES: GroundStationRole[] = ["direct", "relay", "receiver"];

export const DEMO_MESH_HEALTH: MeshHealth = {
  up: true,
  peer_count: 2,
  selected_gateway: "aa:bb:cc:00:11:01",
  partition: false,
  mesh_id: "ados-mesh-01",
};

/** batman-adv neighbours as the agent reports them: `last_seen_ms` is the
 * epoch time each was last heard, a fixed age before `now`. */
export function demoMeshNeighbors(now: number): MeshNeighbor[] {
  return [
    { mac: "aa:bb:cc:00:11:02", iface: "bat0", tq: 244, last_seen_ms: now - 320 },
    { mac: "aa:bb:cc:00:11:03", iface: "bat0", tq: 198, last_seen_ms: now - 640 },
  ];
}

export const DEMO_MESH_ROUTES: MeshRoute[] = [
  { dest: "aa:bb:cc:00:11:02", via: null, metric: 244 },
  { dest: "aa:bb:cc:00:11:03", via: "aa:bb:cc:00:11:02", metric: 210 },
];

export const DEMO_MESH_GATEWAYS: MeshGateway[] = [
  { mac: "aa:bb:cc:00:11:01", class_up_kbps: 20000, class_down_kbps: 100000, tq: 255, selected: true },
  { mac: "aa:bb:cc:00:11:02", class_up_kbps: 8000, class_down_kbps: 40000, tq: 220, selected: false },
];

/** Relays feeding the receiver, last seen a fixed age before `now`: two
 * measured, one not yet measured (null renders as "—", never a fabricated 0). */
export function demoReceiverRelays(now: number): WfbReceiverRelay[] {
  return [
    { mac: "aa:bb:cc:00:11:02", last_seen_ms: now - 320, fragments: 148102 },
    { mac: "aa:bb:cc:00:11:03", last_seen_ms: now - 640, fragments: 52310 },
    { mac: "aa:bb:cc:00:11:04", last_seen_ms: now - 1200, fragments: null },
  ];
}

export const DEMO_RECEIVER_COMBINED: WfbReceiverCombined = {
  fragments_after_dedup: 196480,
  fec_repaired: 1312,
  output_kbps: 9800,
  up: true,
  stale: false,
};

/** Forwarder state shown if the operator switches the demo node to relay. */
export function demoRelayStatus(now: number): WfbRelayStatus {
  return {
    role: "relay",
    drone_iface: "wlan1",
    receiver_ip: "192.168.7.1",
    receiver_port: 5800,
    receiver_last_seen_ms: now - 240,
    fragments_seen: 148230,
    fragments_forwarded: 148102,
    up: true,
    mesh_iface: "bat0",
    stale: false,
  };
}

/** A relay asking to join while the demo pairing window is open. */
export const DEMO_PENDING_RELAY: PairingPendingRequest = {
  device_id: "relay-node-05",
  received_at_ms: 0,
  remote_ip: "192.168.4.1",
};

/** The mesh methods the Mesh & RX surface calls. */
export type DemoMeshMethods = Pick<
  GroundStationApi,
  | "baseUrl"
  | "getRole"
  | "setRole"
  | "getMeshHealth"
  | "getMeshNeighbors"
  | "getMeshRoutes"
  | "getMeshGateways"
  | "setMeshGatewayPreference"
  | "getWfbRelayStatus"
  | "getWfbReceiverRelays"
  | "getWfbReceiverCombined"
  | "getPairingPending"
  | "openPairingWindow"
  | "closePairingWindow"
  | "approvePairing"
  | "revokeRelay"
>;

interface DemoMeshState {
  role: GroundStationRole;
  pinnedGateway: string | null;
  /** Relay MACs the operator revoked since the last reset. */
  revoked: string[];
  window: PairingWindow | null;
  pending: PairingPendingRequest[];
  approvals: Record<string, number>;
}

function initialState(role: GroundStationRole): DemoMeshState {
  return {
    role,
    pinnedGateway: null,
    revoked: [],
    window: null,
    pending: [],
    approvals: {},
  };
}

/** Rejection a real agent answers for a read the current role cannot serve. */
function notInRole(what: string, role: GroundStationRole): Error {
  return new Error(`${what} is not available while this node is ${role}.`);
}

export class DemoGroundStationMesh implements DemoMeshMethods {
  readonly baseUrl = DEMO_MESH_BASE_URL;
  private state: DemoMeshState = initialState(DEMO_GS_ROLE);

  /** Back to the boot state: closed window, three relays, in `role` (the
   * focused demo station's role; the receiver by default). */
  reset(role: GroundStationRole = DEMO_GS_ROLE): void {
    this.state = initialState(role);
  }

  /** The window, or null once its deadline has passed. */
  private openWindow(): PairingWindow | null {
    const w = this.state.window;
    if (w && Date.now() >= w.closes_at_ms) {
      this.state.window = null;
      this.state.pending = [];
    }
    return this.state.window;
  }

  getRole = async (): Promise<RoleInfo> => ({
    current: this.state.role,
    configured: this.state.role,
    supported: [...SUPPORTED_ROLES],
    mesh_capable: true,
  });

  setRole = async (role: GroundStationRole): Promise<RoleInfo> => {
    this.state.role = role;
    this.state.window = null;
    this.state.pending = [];
    return this.getRole();
  };

  private requireMesh(what: string): void {
    const { role } = this.state;
    if (role !== "relay" && role !== "receiver") throw notInRole(what, role);
  }

  getMeshHealth = async (): Promise<MeshHealth> => {
    this.requireMesh("Mesh health");
    return {
      ...DEMO_MESH_HEALTH,
      selected_gateway: this.state.pinnedGateway ?? DEMO_MESH_HEALTH.selected_gateway,
    };
  };

  getMeshNeighbors = async (): Promise<{ neighbors: MeshNeighbor[] }> => {
    this.requireMesh("Mesh neighbours");
    return { neighbors: demoMeshNeighbors(Date.now()) };
  };

  getMeshRoutes = async (): Promise<{ routes: MeshRoute[] }> => {
    this.requireMesh("Mesh routes");
    return { routes: DEMO_MESH_ROUTES.map((r) => ({ ...r })) };
  };

  getMeshGateways = async (): Promise<{ gateways: MeshGateway[]; selected: string | null }> => {
    this.requireMesh("Mesh gateways");
    const selected = this.state.pinnedGateway ?? DEMO_MESH_HEALTH.selected_gateway;
    return {
      gateways: DEMO_MESH_GATEWAYS.map((g) => ({ ...g, selected: g.mac === selected })),
      selected,
    };
  };

  setMeshGatewayPreference = async (
    update: MeshGatewayPreferenceUpdate,
  ): Promise<{ mode: string; pinned_mac: string | null }> => {
    this.state.pinnedGateway = update.mode === "pinned" ? (update.pinned_mac ?? null) : null;
    return { mode: update.mode, pinned_mac: this.state.pinnedGateway };
  };

  getWfbRelayStatus = async (): Promise<WfbRelayStatus> => {
    if (this.state.role !== "relay") throw notInRole("Relay status", this.state.role);
    return demoRelayStatus(Date.now());
  };

  getWfbReceiverRelays = async (): Promise<WfbReceiverRelays> => {
    if (this.state.role !== "receiver") throw notInRole("Receiver relays", this.state.role);
    const relays = demoReceiverRelays(Date.now()).filter(
      (r) => !this.state.revoked.includes(r.mac),
    );
    return { relays, stale: false };
  };

  getWfbReceiverCombined = async (): Promise<WfbReceiverCombined> => {
    if (this.state.role !== "receiver") throw notInRole("Combined stream", this.state.role);
    return { ...DEMO_RECEIVER_COMBINED };
  };

  getPairingPending = async (): Promise<PairingSnapshot> => {
    const w = this.openWindow();
    if (!w) return { open: false, pending: [], approvals: { ...this.state.approvals } };
    return {
      open: true,
      opened_at_ms: w.opened_at_ms,
      closes_at_ms: w.closes_at_ms,
      pending: this.state.pending.map((p) => ({ ...p })),
      approvals: { ...this.state.approvals },
      code: w.code,
    };
  };

  openPairingWindow = async (duration_s = 60): Promise<PairingWindow> => {
    if (this.state.role !== "receiver") throw notInRole("The pairing window", this.state.role);
    // Idempotent during an open window, like the agent.
    const open = this.openWindow();
    if (open) return { ...open };
    const now = Date.now();
    this.state.window = {
      opened_at_ms: now,
      closes_at_ms: now + duration_s * 1000,
      duration_s,
      code: DEMO_JOIN_CODE,
    };
    this.state.pending = [{ ...DEMO_PENDING_RELAY, received_at_ms: now }];
    return { ...this.state.window };
  };

  closePairingWindow = async (): Promise<{ closed: boolean }> => {
    this.state.window = null;
    this.state.pending = [];
    return { closed: true };
  };

  approvePairing = async (device_id: string): Promise<PairingApproveResult> => {
    if (!this.state.pending.some((p) => p.device_id === device_id)) {
      throw new Error(`No pending join request from ${device_id}.`);
    }
    const now = Date.now();
    this.state.pending = this.state.pending.filter((p) => p.device_id !== device_id);
    this.state.approvals = { ...this.state.approvals, [device_id]: now };
    return {
      device_id,
      invite_blob_hex: "00".repeat(32),
      issued_at_ms: now,
      expires_at_ms: now + 120_000,
    };
  };

  revokeRelay = async (device_id: string): Promise<PairingRevokeResult> => {
    const known = demoReceiverRelays(0).some((r) => r.mac === device_id);
    const revoked = known && !this.state.revoked.includes(device_id);
    if (revoked) this.state.revoked = [...this.state.revoked, device_id];
    return { device_id, revoked };
  };
}

/** The one demo mesh client; the seed resets it on every reseed. */
export const demoGroundStationMesh = new DemoGroundStationMesh();
