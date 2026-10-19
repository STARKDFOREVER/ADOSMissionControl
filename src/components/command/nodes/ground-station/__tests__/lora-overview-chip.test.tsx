/**
 * @license GPL-3.0-only
 *
 * The ground-station overview's LoRa chip: duty use while transmit is
 * allowed, a counting-down pause while a waiting rule holds it, a named block
 * otherwise, and nothing for an absent lane or another node's slice.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../locales/en.json";
import type { LoraStatus } from "@/lib/api/ground-station/types";
import { useLoraStore } from "@/stores/ground-station/lora-store";
import { GroundStationLoraChip, LoraOverviewChip } from "../lora/LoraOverviewChip";
import { DEMO_LORA } from "@/mock/demo-seed/ground-station-lanes";

afterEach(() => {
  cleanup();
  useLoraStore.getState().clear();
});

const NOW = 1_760_860_000_000;

function chip(status: LoraStatus, fetchedAt: number | null = NOW, now = NOW) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LoraOverviewChip status={status} fetchedAt={fetchedAt} now={now} />
    </NextIntlClientProvider>,
  );
}

describe("LoraOverviewChip", () => {
  it("shows the region and duty used while transmit is allowed", () => {
    chip(DEMO_LORA);
    expect(screen.getByRole("status").textContent).toBe("LoRa IN 0.4 %");
  });

  it("counts the pause down locally between polls", () => {
    const paused = {
      ...DEMO_LORA,
      tx_allowed: false,
      blocked_reason: "duty_exhausted",
      governor: { ...DEMO_LORA.governor!, next_tx_allowed_ms: 462_000 },
    };
    chip(paused, NOW, NOW + 2_000);
    expect(screen.getByRole("status").textContent).toBe("LoRa paused 07:40");
  });

  it("names the block when waiting cannot clear it", () => {
    chip({ ...DEMO_LORA, region: null, tx_allowed: false, blocked_reason: "region_unset" });
    expect(screen.getByRole("status").textContent).toBe("LoRa blocked: region");
  });

  it("renders nothing for an absent lane", () => {
    chip({ ...DEMO_LORA, present: false });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("GroundStationLoraChip", () => {
  it("never shows another node's slice", () => {
    useLoraStore.setState({ loraFor: "http://192.168.1.60:8080", status: DEMO_LORA, fetchedAt: NOW });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <GroundStationLoraChip agentUrl="http://192.168.1.50:8080" apiKey="k" />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the slice read from this node", () => {
    useLoraStore.setState({ loraFor: "http://192.168.1.50:8080", status: DEMO_LORA, fetchedAt: Date.now() });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <GroundStationLoraChip agentUrl="http://192.168.1.50:8080/" apiKey="k" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe("LoRa IN 0.4 %");
  });
});
