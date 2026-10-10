// Embedded install catalog for the Flash Tool.
//
// This is the catalog the Flash Tool serves; there is no remote fetch.
// Every curl command runs the installer script from `main`, which fetches
// signed release binaries. Every board installs the single agent with the
// same script; the profile flag selects drone vs ground-station.
//
// Lives in a sibling module to route.ts because Next.js Route segment
// files may only export the HTTP method handlers and route-segment
// options.

import type { AdosAgentManifestData } from "@/lib/protocol/firmware/ados-agent-manifest";
import {
  AGENT_INSTALL_CMD as FULL_INSTALL_CMD,
  AGENT_INSTALL_GROUND_CMD as FULL_INSTALL_GROUND_CMD,
} from "@/lib/agent/install-script";

export const EMBEDDED_CATALOG: AdosAgentManifestData = {
  schemaVersion: 1,
  generatedAt: "2026-05-06T00:00:00Z",
  boards: [
    {
      id: "pi-zero-2w",
      label: "Raspberry Pi Zero 2 W",
      soc: "BCM2710A1",
      arch: "aarch64-glibc",
      stacks: ["ados-drone-agent"],
      description: "512 MB LPDDR2, microSD boot, mainline Wi-Fi.",
      installs: {
        "ados-drone-agent": {
          method: "curl",
          command: FULL_INSTALL_CMD,
          notes: [
            "Run on a Pi already booted into Raspberry Pi OS Lite.",
            "Connect to your Wi-Fi network before running the command.",
          ],
        },
      },
    },
    {
      id: "rpi4b",
      label: "Raspberry Pi 4B",
      soc: "BCM2711",
      arch: "aarch64-glibc",
      stacks: ["ados-drone-agent", "ados-ground-agent"],
      description: "1-8 GB RAM, microSD boot.",
      installs: {
        "ados-drone-agent": {
          method: "curl",
          command: FULL_INSTALL_CMD,
          notes: ["Run on a Pi already booted into Raspberry Pi OS."],
        },
        "ados-ground-agent": {
          method: "curl",
          command: FULL_INSTALL_GROUND_CMD,
          notes: [
            "Run on a Pi already booted into Raspberry Pi OS.",
            "Plug in your RTL8812EU adapter, OLED display, and buttons before running the installer if you want them auto-detected.",
          ],
        },
      },
    },
    {
      id: "rk3566",
      label: "Radxa CM3 (RK3566)",
      soc: "RK3566",
      arch: "aarch64-glibc",
      stacks: ["ados-drone-agent", "ados-ground-agent"],
      description: "2-8 GB RAM, eMMC + microSD options.",
      installs: {
        "ados-drone-agent": {
          method: "curl",
          command: FULL_INSTALL_CMD,
          notes: ["Run on a CM3 booted into Radxa OS."],
        },
        "ados-ground-agent": {
          method: "curl",
          command: FULL_INSTALL_GROUND_CMD,
          notes: ["Run on a CM3 booted into Radxa OS."],
        },
      },
    },
    {
      id: "rk3588s2",
      label: "Radxa CM4 (RK3588S2)",
      soc: "RK3588S2",
      arch: "aarch64-glibc",
      stacks: ["ados-drone-agent", "ados-ground-agent"],
      description: "4-32 GB RAM, eMMC + microSD options.",
      installs: {
        "ados-drone-agent": {
          method: "curl",
          command: FULL_INSTALL_CMD,
          notes: ["Run on a CM4 booted into Radxa OS."],
        },
        "ados-ground-agent": {
          method: "curl",
          command: FULL_INSTALL_GROUND_CMD,
          notes: ["Run on a CM4 booted into Radxa OS."],
        },
      },
    },
    {
      id: "rock-5c-lite",
      label: "Radxa Rock 5C Lite",
      soc: "RK3582",
      arch: "aarch64-glibc",
      stacks: ["ados-drone-agent", "ados-ground-agent"],
      description: "8-16 GB RAM, NPU + VPU intact for vision workloads.",
      installs: {
        "ados-drone-agent": {
          method: "curl",
          command: FULL_INSTALL_CMD,
          notes: ["Run on a Rock 5C Lite booted into Radxa OS."],
        },
        "ados-ground-agent": {
          method: "curl",
          command: FULL_INSTALL_GROUND_CMD,
          notes: ["Run on a Rock 5C Lite booted into Radxa OS."],
        },
      },
    },
    {
      id: "cubie-a7z",
      label: "Radxa Cubie A7Z",
      soc: "Allwinner A733",
      arch: "aarch64-glibc",
      stacks: ["ados-drone-agent", "ados-ground-agent"],
      description: "Pi-Zero-sized Cortex-A55 SBC, 1 GB RAM.",
      installs: {
        "ados-drone-agent": {
          method: "curl",
          command: FULL_INSTALL_CMD,
          notes: [
            "Run on a Cubie A7Z booted into the BSP image.",
            "Mainline A733 support is incomplete; stick with the BSP kernel.",
          ],
        },
        "ados-ground-agent": {
          method: "curl",
          command: FULL_INSTALL_GROUND_CMD,
          notes: [
            "Run on a Cubie A7Z booted into the BSP image.",
            "Plug in your RTL8812EU adapter, OLED display, and buttons before running so they auto-detect.",
          ],
        },
      },
    },
  ],
};
