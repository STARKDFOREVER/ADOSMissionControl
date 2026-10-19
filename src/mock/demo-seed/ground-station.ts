/**
 * @module mock/demo-seed/ground-station
 * @description Seeds every ground-station store slice the node-detail tabs read in demo mode.
 * @license GPL-3.0-only
 */

import { useGroundStationStore } from "@/stores/ground-station-store";
import type { PhoneInvite } from "@/lib/api/ground-station/types";
import type { GroundStationApi } from "@/lib/api/ground-station-api";
import { setDemoMeshApi } from "@/lib/api/ground-station/mesh-source";
import {
  DEMO_GS_ROLE,
  DEMO_MESH_BASE_URL,
  DEMO_MESH_GATEWAYS,
  DEMO_MESH_HEALTH,
  DEMO_MESH_ROUTES,
  DEMO_RECEIVER_COMBINED,
  demoGroundStationMesh,
  demoMeshNeighbors,
  demoReceiverRelays,
} from "@/mock/ground-station-mesh";
import { seedGroundStationLanes } from "./ground-station-lanes";

/** Phone receivers waiting for approval on the demo ground station. The expiry
 * is a far-future constant: the demo has no agent to lapse it. */
export const DEMO_PHONE_INVITES: readonly PhoneInvite[] = [
  {
    invite_id: "demo-invite-1",
    label: "Pilot tablet",
    phone_fingerprint: "6668-7AAD-F862-BD77",
    expires_at_ms: 4_102_444_800_000,
  },
  {
    invite_id: "demo-invite-2",
    label: "Observer phone",
    phone_fingerprint: "3B9C-01E4-A7D2-5F60",
    expires_at_ms: 4_102_444_800_000,
  },
];

/** Seed every ground-station store slice the node-detail GS tabs read — the
 * Overview cards (link health, uplink, paired drone, mesh role/health) plus the
 * Radio / Network / Mesh / Distributed-RX / Display / Physical-UI / Peripherals
 * tables. In demo the GS REST client is null (groundStationApiFromAgent), so the
 * tabs' load-on-mount polls no-op and this seeded data renders untouched.
 *
 * The Mesh & RX surface is the exception: it resolves the in-memory demo mesh
 * client (mock/ground-station-mesh), reset and installed here, and the mesh
 * slices are tagged with that client's origin (`meshFor`) so the surface
 * reads them as this node's own. */
export function seedGroundStationStore(): void {
  demoGroundStationMesh.reset();
  setDemoMeshApi(demoGroundStationMesh as unknown as GroundStationApi);
  seedGroundStationLanes();
  useGroundStationStore.setState({
    meshFor: DEMO_MESH_BASE_URL,
    status: {
      paired_drone: "alpha-1",
      profile: "ground_station",
      uplink_active: "ethernet",
    },
    statusFetchedAt: Date.now(),
    linkHealth: {
      rssi_dbm: -58,
      bitrate_mbps: 18.5,
      fec_rec: 1240,
      fec_lost: 9,
      channel: 149,
    },
    // WiFi access point + full uplink matrix (WiFi client / Ethernet / 4G) for
    // the Network tab's per-uplink sections.
    ap: {
      enabled: true,
      ssid: "ADOS-GS-AP",
      passphrase: "altnautica",
      channel: 6,
      connected_clients: 1,
    },
    network: {
      ap: {
        enabled: true,
        ssid: "ADOS-GS-AP",
        passphrase: "altnautica",
        channel: 6,
        connected_clients: 1,
      },
      wifi_client: {
        available: true,
        connected: false,
        ssid: null,
        rssi_dbm: null,
        ip: null,
      },
      ethernet: {
        available: true,
        link: true,
        speed_mbps: 1000,
        ip: "192.168.1.60",
        gateway: "192.168.1.1",
        iface: "eth0",
      },
      modem_4g: {
        enabled: false,
        apn: "internet",
        cap_mb: null,
        connected: null,
        iface: null,
        ip: null,
        signal_quality: null,
        technology: null,
        operator: null,
        state: null,
        data_used_mb: null,
        percent: null,
      },
      active_uplink: "ethernet",
      priority: ["ethernet", "wifi", "modem"],
      share_uplink: false,
    },
    modem: {
      enabled: false,
      apn: "internet",
      cap_mb: null,
      connected: null,
      iface: null,
      ip: null,
      signal_quality: null,
      technology: null,
      operator: null,
      state: null,
      data_used_mb: null,
      percent: null,
    },
    ethernetConfig: { mode: "dhcp" },
    uplink: {
      active: "ethernet",
      priority: ["ethernet", "wifi", "modem"],
      health: "ok",
      failover_log: [],
      data_cap: null,
      cloud_relay: {
        mqtt_connected: true,
        throttle_state: "ok",
        forwarding_video: true,
        forwarding_telemetry: true,
      },
      routeApplied: true,
      shareUplinkApplied: null,
      shareUplinkAppliedReason: null,
      loading: false,
      error: null,
      fetchedAt: Date.now(),
    },
    // A mesh receiver: it combines the streams its relays forward, so Mesh &
    // RX shows the relay list, combined-stream stats and the pairing window.
    role: {
      info: {
        current: DEMO_GS_ROLE,
        configured: DEMO_GS_ROLE,
        supported: ["direct", "relay", "receiver"],
        mesh_capable: true,
      },
      loading: false,
      switching: false,
      error: null,
      fetchedAt: Date.now(),
    },
    // batman-adv mesh: neighbors, routes, and the elected cloud gateway for the
    // Mesh tab's neighbor / gateway tables + health card.
    mesh: {
      health: { ...DEMO_MESH_HEALTH },
      neighbors: demoMeshNeighbors(Date.now()),
      routes: DEMO_MESH_ROUTES.map((r) => ({ ...r })),
      gateways: DEMO_MESH_GATEWAYS.map((g) => ({ ...g })),
      selectedGateway: DEMO_MESH_HEALTH.selected_gateway,
      lastTransientEvent: null,
      wsState: "connected",
      wsDisconnectedAt: null,
      loading: false,
      error: null,
      fetchedAt: Date.now(),
    },
    // Distributed-RX receiver state: the relays feeding this node and the
    // combined stream, with the pairing window closed until the operator
    // opens it.
    distributedRx: {
      receiverRelays: demoReceiverRelays(Date.now()),
      combined: { ...DEMO_RECEIVER_COMBINED },
      relayStatus: null,
      pairingWindowOpen: false,
      pairingWindowExpiresAt: null,
      pairingCode: null,
      pendingRequests: [],
      loading: false,
      error: null,
    },
    // Physical UI (OLED brightness + button bindings + screen order) for the
    // Physical UI tab, plus a paired gamepad for its Bluetooth section.
    ui: {
      oled: { brightness: 180 },
      buttons: {
        button_a: { short_press: "next_screen", long_press: "toggle_backlight" },
        button_b: { short_press: "prev_screen", long_press: "open_pair_window" },
        button_c: { short_press: "cycle_uplink" },
        button_d: { short_press: "mute_alerts", long_press: "reboot" },
      },
      screens: {
        order: ["link", "uplink", "mesh", "pair"],
        enabled: ["link", "uplink", "mesh", "pair"],
      },
    },
    bluetooth: {
      scanning: false,
      scan_results: [],
      paired: [
        {
          mac: "44:55:66:77:88:99",
          name: "Wireless Gamepad",
          rssi_dbm: -52,
          paired: true,
          connected: true,
        },
      ],
      // Demo has no ground-station REST client, so the list belongs to no node URL.
      pairedFor: null,
      pairing_mac: null,
      error: null,
    },
    // Local HDMI/LCD display config for the Display tab.
    display: { resolution: "480x320", kiosk_enabled: false },
    // Attached peripherals for the Peripherals tab.
    peripherals: {
      list: [
        {
          id: "oled-0",
          display_name: "OLED 128x64 (SSD1306)",
          transport: "serial",
          connected: true,
          capabilities: ["display"],
        },
        {
          id: "gamepad-0",
          display_name: "USB Gamepad",
          transport: "usb",
          connected: true,
          capabilities: ["joystick", "buttons"],
        },
        {
          id: "gnss-0",
          display_name: "u-blox GNSS Receiver",
          transport: "usb",
          connected: true,
          capabilities: ["gnss"],
        },
      ],
      detail: {},
      loading: false,
      error: null,
    },
  });
}
