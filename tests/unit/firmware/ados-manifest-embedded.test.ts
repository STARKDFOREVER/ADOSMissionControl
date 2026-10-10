/**
 * The embedded ADOS Agent install catalog served by `/api/ados-manifest`.
 *
 * Every board the catalog advertises must exist in the agent's HAL board
 * set (snapshot in tests/fixtures/ados-agent-manifest.fixture.json; its
 * leading "_comment" field documents how to refresh it), and every curl
 * command must run the installer script from `main` with `curl -fsSL`.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import fixture from "../../fixtures/ados-agent-manifest.fixture.json";
import { EMBEDDED_CATALOG } from "@/app/api/ados-manifest/embedded-catalog";
import { DEMO_ADOS_BOARDS } from "@/components/fc/firmware/firmware-state/demo-catalog";
import { GET } from "@/app/api/ados-manifest/route";
import {
  AGENT_INSTALL_SCRIPT_URL,
  buildAgentInstallCommand,
} from "@/lib/agent/install-script";

const ALL_BOARDS = [...EMBEDDED_CATALOG.boards, ...DEMO_ADOS_BOARDS];

describe("ADOS manifest embedded catalog", () => {
  it("the fixture has at least one board id (sanity check)", () => {
    expect(fixture.boardIds.length).toBeGreaterThan(0);
  });

  it("every embedded board id appears in the upstream emitter snapshot", () => {
    const upstream = new Set<string>(fixture.boardIds);
    const missing = EMBEDDED_CATALOG.boards
      .map((b) => b.id)
      .filter((id) => !upstream.has(id));
    expect(missing).toEqual([]);
  });

  it("only declares known stacks, each with an install", () => {
    const allowed = new Set(["ados-drone-agent", "ados-ground-agent"]);
    for (const board of EMBEDDED_CATALOG.boards) {
      for (const stack of board.stacks) {
        expect(allowed.has(stack)).toBe(true);
        expect(board.installs[stack]).toBeDefined();
      }
    }
  });

  it("every install command runs the main-branch script with curl -fsSL", () => {
    for (const board of ALL_BOARDS) {
      for (const install of Object.values(board.installs)) {
        if (install?.method !== "curl") continue;
        expect(install.command.startsWith(`curl -fsSL ${AGENT_INSTALL_SCRIPT_URL}`)).toBe(true);
        expect(install.command).not.toContain("releases/latest/download");
      }
    }
  });

  it("the route serves the embedded catalog with no release pin", async () => {
    const body = await (await GET()).json();
    expect(body.source).toBe("embedded");
    expect(body).not.toHaveProperty("agentVersion");
    expect(body.boards.length).toBe(EMBEDDED_CATALOG.boards.length);
  });
});

describe("buildAgentInstallCommand", () => {
  it("emits no args by default", () => {
    expect(buildAgentInstallCommand()).toBe(`curl -fsSL ${AGENT_INSTALL_SCRIPT_URL} | sudo bash`);
  });

  it("maps options to installer flags", () => {
    expect(
      buildAgentInstallCommand({
        profile: "ground-station",
        upgrade: true,
        channel: "edge",
        version: "1.2.3",
        pairCode: "ABCD-1234",
      }),
    ).toBe(
      `curl -fsSL ${AGENT_INSTALL_SCRIPT_URL} | sudo bash -s -- --upgrade --profile ground-station --channel edge --version 1.2.3 --pair ABCD-1234`,
    );
  });
});
