/**
 * @module mock/agent/radio
 * @description Demo WFB radio and CRSF / ExpressLRS control-lane blocks for
 * the demo agents' capability payloads, plus the demo ground station's
 * multi-adapter WFB receive set (one transmit-capable omni adapter and two
 * receive-only adapters feeding the diversity combiner) and its pilot +
 * autonomy ELRS module pair.
 * @license GPL-3.0-only
 */

import type {
  CrsfState,
  ElrsModule,
  RadioAdapter,
  RadioState,
} from "@/lib/api/ground-station/types";

/** Demo air-side radio snapshot so the Radio / Network Health panel renders
 * its live indicators in `npm run demo`: a US-domain link locked on its home
 * channel (so it reads "pinned"), TX active with a ground decode, an
 * injection-capable adapter, and a healthy link-diagnosis verdict backed by a
 * flowing received-frame count (the honest received-side proof, no fabricated reading). The
 * normalizer fills any field omitted here. */
export const MOCK_RADIO: Partial<RadioState> = {
  state: "connected",
  iface: "wlan1",
  driver: "rtl88x2eu",
  channel: 149,
  freqMhz: 5745,
  homeChannel: 149,
  band: "u-nii-3",
  regDomain: "US",
  monitorActive: true,
  txActive: true,
  peerLink: "linked",
  acquireState: "locked",
  channelLocked: true,
  adapterChipset: "RTL8812EU",
  adapterInjectionOk: true,
  // The demo link decodes on the ground, so the radio's transmit-proof
  // verdict is an explicit false (proven), not an absent reading.
  rfUnverified: false,
  rssiDbm: -44,
  snrDb: 32,
  bitrateKbps: 18500,
  fecRecovered: 1240,
  fecLost: 9,
  lossPercent: 0.4,
  // A healthy link-diagnosis verdict, proven by a flowing received-frame count.
  linkDiag: "healthy",
  packetsAll: 152340,
  validRxPacketsPerS: 312,
  decryptErrors: 0,
  paired: true,
};

/** Demo CRSF / ExpressLRS control-lane snapshot so the RC / ELRS Link tab
 * renders a populated, honest lane in `npm run demo`: a healthy 900 MHz link
 * transmitting handset RC channels through a relay role, with the transmit
 * proven (rfUnverified false) and the RC command path open (fcCommandDownGated
 * false — an RC lane's sticks reach the FC). Read loosely off the caps payload
 * by the normalizer (camelCase), like the radio block. */
export const MOCK_CRSF: Partial<CrsfState> = {
  state: "link_ok",
  rssiDbm: -62,
  lqUplink: 98,
  lqDownlink: 95,
  snrDb: 9,
  band: "900 MHz",
  packetRateHz: 150,
  txPowerMw: 250,
  txFramesPerS: 150,
  rxFramesPerS: 50,
  rfUnverified: false,
  flyable: true,
  mode: "crsf_rc",
  fcCommandDownGated: false,
  channelSource: "hid",
  pic: "claimed",
  relayRole: "relay",
};

export const MOCK_GS_ADAPTERS: RadioAdapter[] = [
  {
    iface: "wlan1",
    mac: "02:00:00:00:01:01",
    usb_path: "1-1.2",
    driver: "rtl88x2eu",
    role: "rxtx",
    antenna: "omni-5.8",
    tx_active: true,
    rssi_dbm: [-48, -51],
    packets: 120_345,
    lost: 1_462,
    fec_rec: 540,
    verified: true,
  },
  {
    iface: "wlan2",
    mac: "02:00:00:00:01:02",
    usb_path: "1-1.3",
    driver: "rtl88x2eu",
    role: "rx",
    antenna: "lhcp-patch-5.8",
    tx_active: false,
    rssi_dbm: [-55, -57],
    packets: 118_904,
    lost: 2_903,
    fec_rec: 612,
    verified: true,
  },
  {
    iface: "wlan3",
    mac: "02:00:00:00:01:03",
    usb_path: "1-1.4",
    driver: "rtl88x2eu",
    role: "rx",
    antenna: null,
    tx_active: false,
    rssi_dbm: [-61, -63],
    packets: 116_988,
    lost: 4_819,
    fec_rec: 733,
    verified: true,
  },
];

export const MOCK_GS_ELRS_MODULES: ElrsModule[] = [
  {
    id: "m0",
    port: "/dev/ttyACM1",
    role: "pilot",
    connected: true,
    rssiDbm: [-60, -62],
    lq: 100,
    snrDb: 8,
    txPowerMw: 250,
    rfMode: "500Hz",
    domain: "ISM2G4",
  },
  {
    id: "m1",
    port: "/dev/ttyACM2",
    role: "autonomy",
    connected: true,
    rssiDbm: [-71, -74],
    lq: 94,
    snrDb: 5,
    txPowerMw: 100,
    rfMode: "250Hz",
    // A 900 MHz module still on its factory FCC domain, so the LoRa tab's
    // ELRS-domain advisory has something to say under region IN.
    domain: "FCC915",
  },
];
