/**
 * @module mock/ground-station-mesh.test
 * @description The demo ground station is a mesh receiver whose Mesh & RX
 * surface works end to end in demo: the seed installs the in-memory mesh
 * client and tags the mesh slices with its origin (so the surface reads the
 * seeded role as this node's own instead of "no role set"), and the real store
 * actions run against it — role read and switch, mesh and distributed-RX
 * reads, and the receiver pairing window with its join code.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const demo = vi.hoisted(() => ({ on: true }));
vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isDemoMode: () => demo.on,
}));

import { useGroundStationStore } from "@/stores/ground-station-store";
import { GroundStationApi } from "@/lib/api/ground-station-api";
import { meshApiFromAgent, setDemoMeshApi } from "@/lib/api/ground-station/mesh-source";
import { seedGroundStationStore } from "@/mock/demo-seed/ground-station";
import {
  DEMO_JOIN_CODE,
  DEMO_MESH_BASE_URL,
  DEMO_PENDING_RELAY,
  demoGroundStationMesh,
  demoReceiverRelays,
} from "@/mock/ground-station-mesh";
import { DEMO_GROUND_STATION } from "@/mock/drones";

const RELAY_COUNT = demoReceiverRelays(0).length;

function demoApi(): GroundStationApi {
  const api = meshApiFromAgent("mock://demo", null);
  if (!api) throw new Error("demo mesh client not installed");
  return api;
}

beforeEach(() => {
  demo.on = true;
  seedGroundStationStore();
});

afterEach(() => {
  setDemoMeshApi(null);
  vi.useRealTimers();
});

describe("demo ground-station mesh seed", () => {
  it("seeds a receiver whose mesh slices belong to the demo mesh client", () => {
    const s = useGroundStationStore.getState();
    expect(DEMO_GROUND_STATION.role).toBe("receiver");
    expect(s.role.info?.current).toBe("receiver");
    expect(s.meshFor).toBe(DEMO_MESH_BASE_URL);
    expect(demoApi().baseUrl).toBe(s.meshFor);
    expect(s.distributedRx.receiverRelays).toHaveLength(RELAY_COUNT);
    expect(s.distributedRx.combined).not.toBeNull();
    expect(s.distributedRx.pairingWindowOpen).toBe(false);
  });

  it("resolves no mesh client without an agent URL", () => {
    expect(meshApiFromAgent(null, null)).toBeNull();
  });

  it("off demo resolves the agent's own REST client, never the demo one", () => {
    demo.on = false;
    const api = meshApiFromAgent("http://gs.example.com:8080", "k");
    expect(api).toBeInstanceOf(GroundStationApi);
    expect(api?.baseUrl).toBe("http://gs.example.com:8080");
  });
});

describe("store actions against the demo mesh client", () => {
  it("re-reads the seeded role and receiver state without resetting it", async () => {
    const api = demoApi();
    const store = useGroundStationStore.getState();
    await store.loadRole(api);
    await store.loadMesh(api);
    await store.loadDistributedRx(api);
    const s = useGroundStationStore.getState();
    expect(s.role.info?.current).toBe("receiver");
    expect(s.role.error).toBeNull();
    expect(s.mesh.error).toBeNull();
    expect(s.mesh.neighbors.length).toBeGreaterThan(0);
    expect(s.distributedRx.error).toBeNull();
    expect(s.distributedRx.receiverRelays).toHaveLength(RELAY_COUNT);
  });

  it("reports last-seen as epoch timestamps, like the agent", async () => {
    const now = Date.now();
    const { neighbors } = await demoApi().getMeshNeighbors();
    const { relays } = await demoApi().getWfbReceiverRelays();
    for (const t of [...neighbors, ...(relays ?? [])].map((r) => r.last_seen_ms)) {
      expect(t).toBeLessThanOrEqual(now + 1000);
      expect(now - t).toBeLessThan(5_000);
    }
  });

  it("drops a revoked relay from later reads", async () => {
    const api = demoApi();
    const store = useGroundStationStore.getState();
    const mac = demoReceiverRelays(0)[0].mac;
    expect(await store.revokeRelay(api, mac)).toBe(true);
    await store.loadDistributedRx(api);
    const relays = useGroundStationStore.getState().distributedRx.receiverRelays ?? [];
    expect(relays.map((r) => r.mac)).not.toContain(mac);
    expect(relays).toHaveLength(RELAY_COUNT - 1);
  });

  it("opens the pairing window with the fixed join code, then closes it", async () => {
    const api = demoApi();
    const store = useGroundStationStore.getState();
    expect(await store.openPairingWindow(api, 60)).toBe(true);
    let s = useGroundStationStore.getState().distributedRx;
    expect(s.pairingWindowOpen).toBe(true);
    expect(s.pairingCode).toBe(DEMO_JOIN_CODE);
    expect(s.pairingWindowExpiresAt).toBeGreaterThan(Date.now());

    await store.loadPairingPending(api);
    s = useGroundStationStore.getState().distributedRx;
    expect(s.pairingWindowOpen).toBe(true);
    expect(s.pairingCode).toBe(DEMO_JOIN_CODE);
    expect(s.pendingRequests.map((r) => r.device_id)).toEqual([DEMO_PENDING_RELAY.device_id]);

    expect(await store.approvePairing(api, DEMO_PENDING_RELAY.device_id)).toBe(true);
    await store.loadPairingPending(api);
    expect(useGroundStationStore.getState().distributedRx.pendingRequests).toEqual([]);

    expect(await store.closePairingWindow(api)).toBe(true);
    await store.loadPairingPending(api);
    s = useGroundStationStore.getState().distributedRx;
    expect(s.pairingWindowOpen).toBe(false);
    expect(s.pairingCode).toBeNull();
  });

  it("lapses the pairing window at its deadline", async () => {
    vi.useFakeTimers();
    const api = demoApi();
    const store = useGroundStationStore.getState();
    await store.openPairingWindow(api, 60);
    vi.advanceTimersByTime(61_000);
    await store.loadPairingPending(api);
    expect(useGroundStationStore.getState().distributedRx.pairingWindowOpen).toBe(false);
  });

  it("switches role and serves the relay forwarder afterwards", async () => {
    const api = demoApi();
    const store = useGroundStationStore.getState();
    const info = await store.applyRole(api, "relay");
    expect(info?.current).toBe("relay");
    await store.loadDistributedRx(api);
    const s = useGroundStationStore.getState();
    expect(s.role.info?.current).toBe("relay");
    expect(s.distributedRx.relayStatus?.role).toBe("relay");
    // A relay has no pairing window to open.
    expect(await store.openPairingWindow(api)).toBe(false);
  });

  it("reseeding restores the receiver after a role switch", async () => {
    await useGroundStationStore.getState().applyRole(demoApi(), "direct");
    seedGroundStationStore();
    expect((await demoGroundStationMesh.getRole()).current).toBe("receiver");
    expect(useGroundStationStore.getState().role.info?.current).toBe("receiver");
  });
});
