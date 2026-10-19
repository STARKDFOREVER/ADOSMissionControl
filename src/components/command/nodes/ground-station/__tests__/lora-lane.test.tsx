/**
 * @license GPL-3.0-only
 *
 * The LoRa tab surfaces the multi-region duty governor: one meter per rule
 * kind the plan declares (unknown kinds render generically), a blocked banner
 * with a reason and a fix action whenever transmit is refused, and an honest
 * "not fitted" state when the node has no LoRa service.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../locales/en.json";
import type { ElrsModule, LoraRegionPlan, LoraStatus } from "@/lib/api/ground-station/types";
import { LoraLaneView } from "../lora/LoraLaneView";
import { countryPlanCode, loraMismatches } from "../lora/lora-format";
import { LoraTab } from "../LoraTab";
import { useLoraStore } from "@/stores/ground-station/lora-store";

vi.mock("@/components/command/settings/use-node-direct-agent", () => ({
  useNodeDirectAgent: () => ({ agentUrl: "http://gs.example.test", apiKey: "k", client: null }),
}));
vi.mock("../use-gs-poll", () => ({ useGroundStationPoll: () => {} }));

afterEach(cleanup);

const NOW = 1_760_860_000_000;

function makeStatus(over: Partial<LoraStatus> = {}): LoraStatus {
  return {
    present: true,
    transport: "e22",
    module_band: "850-930",
    region: {
      code: "IN",
      name: "India",
      plan_id: "IN865",
      source: "network.regulatory.region",
      band_mhz: [865.0, 867.0],
      citation: "G.S.R. 853(E), 2021",
      meshtastic_preset: "IN",
    },
    channel: { freq_mhz: 866.0, bw_khz: 125, sf: 9, erp_mw: 25, max_erp_mw: 25 },
    node_id: 17,
    tx_allowed: true,
    blocked_reason: null,
    governor: {
      rules: [
        { kind: "duty_cycle", window_s: 3600, limit_pct: 1.0, used_pct: 0.4, airtime_ms_window: 14_400, budget_ms_window: 36_000, exhausted: false, sub_band: "865.0-867.0" },
        { kind: "dwell_time", limit_ms: 400, per_s: 20, last_tx_ms: 206, ok: true },
        { kind: "lbt", threshold_dbm: -80, listen_us: 5000, last_rssi_dbm: -112, busy_count: 0 },
        { kind: "max_power", limit_mw: 25, configured_mw: 25, ok: true },
      ],
      next_tx_allowed_ms: 0,
      last_refusal: null,
    },
    tx: { frames: 120, refused: 0, refused_by_rule: { duty_cycle: 0, dwell_time: 0, lbt: 0, max_power: 0, region_unset: 0 } },
    rx: { frames: 340, crc_errors: 2 },
    meshtastic: { enabled: false, connected: false, port: null, region_preset: "IN" },
    ...over,
  };
}

function renderView(status: LoraStatus, extra: { onOpenRegions?: () => void } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LoraLaneView
        status={status}
        regions={null}
        beacons={[]}
        now={NOW}
        fetchedAt={NOW}
        writeLock={null}
        applying={false}
        onApply={() => {}}
        onOpenRegions={extra.onOpenRegions}
      />
    </NextIntlClientProvider>,
  );
}

describe("LoRa governor meters", () => {
  it("renders a meter row for every rule kind the plan declares", () => {
    renderView(makeStatus());
    expect(screen.getByRole("group", { name: "Duty cycle 865.0-867.0" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Dwell time" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Listen before talk" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Maximum power" })).toBeTruthy();
    // Duty, dwell and power draw a bar; LBT reads the last sample instead.
    expect(screen.getAllByRole("meter")).toHaveLength(3);
    expect(screen.getByText("Clear")).toBeTruthy();
    expect(screen.getByText(/14\.4 \/ 36\.0 s per 3600 s/)).toBeTruthy();
  });

  it("renders an unknown rule kind generically instead of crashing", () => {
    const status = makeStatus();
    status.governor!.rules.push({ kind: "frequency_hop", min_channels: 50 });
    renderView(status);
    const row = screen.getByRole("group", { name: "Rule frequency_hop" });
    expect(row.textContent).toContain("min_channels=50");
  });

  it("shows no banner while transmit is allowed", () => {
    renderView(makeStatus());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("LoRa blocked banner", () => {
  it("names region_unset and offers to open the region picker", () => {
    const onOpenRegions = vi.fn();
    renderView(
      makeStatus({ region: null, tx_allowed: false, blocked_reason: "region_unset", governor: { rules: [], next_tx_allowed_ms: 0, last_refusal: null } }),
      { onOpenRegions },
    );
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("TX blocked");
    expect(banner.textContent).toContain("Receiving still works");
    fireEvent.click(screen.getByRole("button", { name: "Set region" }));
    expect(onOpenRegions).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Change LoRa region")).toBeTruthy();
    expect(screen.getByText("Follow country setting")).toBeTruthy();
  });

  it("shows the countdown while the duty budget is exhausted", () => {
    renderView(makeStatus({ tx_allowed: false, blocked_reason: "duty_exhausted", governor: { ...makeStatus().governor!, next_tx_allowed_ms: 462_000 } }));
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("TX paused");
    expect(banner.textContent).toContain("07:42");
  });
});

const IN_ROW: LoraRegionPlan = {
  code: "IN",
  name: "India",
  plan_id: "IN865",
  band_mhz: [865, 867],
  rules: ["duty_cycle", "max_power"],
  supported_by_module: true,
  elrs_domains: { "2g4": "ISM2G4", "900": "IN866" },
};

function mod(id: string, domain: string | null): ElrsModule {
  return { id, port: null, role: "pilot", connected: true, rssiDbm: [], lq: null, snrDb: null, txPowerMw: null, rfMode: null, domain };
}

describe("LoRa region advisories", () => {
  it("flags an ELRS module whose domain differs from the region's expected domain for its band", () => {
    const out = loraMismatches(makeStatus(), IN_ROW, null, null, [mod("m0", "ISM2G4"), mod("m1", "FCC915"), mod("m2", null)]);
    expect(out).toEqual([{ kind: "elrs", module: "m1", domain: "FCC915", expected: "IN866", code: "IN" }]);
  });

  it("makes no ELRS claim when the region expects nothing for that band", () => {
    const row = { ...IN_ROW, elrs_domains: { "2g4": "ISM2G4", "900": null } };
    expect(loraMismatches(makeStatus(), row, null, null, [mod("m1", "FCC915")])).toEqual([]);
    expect(loraMismatches(makeStatus(), { ...IN_ROW, elrs_domains: null }, null, null, [mod("m1", "FCC915")])).toEqual([]);
    // A 2.4 GHz EU module under a region expecting ISM2G4 is flagged.
    expect(loraMismatches(makeStatus(), IN_ROW, null, null, [mod("m0", "CE_LBT")])[0]).toMatchObject({ expected: "ISM2G4" });
  });

  it("flags a Meshtastic preset other than the region's preset, exactly, only when the bridge is enabled", () => {
    const mesh = { enabled: true, connected: true, port: "/dev/ttyACM2", region_preset: "EU_868" };
    expect(loraMismatches(makeStatus({ meshtastic: mesh }), IN_ROW, null, null, [])).toEqual([
      { kind: "meshtastic", preset: "EU_868", expected: "IN" },
    ]);
    expect(loraMismatches(makeStatus({ meshtastic: { ...mesh, enabled: false } }), IN_ROW, null, null, [])).toEqual([]);
    expect(loraMismatches(makeStatus({ meshtastic: { ...mesh, region_preset: "IN" } }), IN_ROW, null, null, [])).toEqual([]);
    // Exact equality: an AU region maps to ANZ, and no prefix rule applies.
    const au = makeStatus({ meshtastic: { ...mesh, region_preset: "ANZ" } });
    au.region = { ...au.region!, code: "AU", meshtastic_preset: "ANZ" };
    expect(loraMismatches(au, null, null, null, [])).toEqual([]);
    const auWrong = makeStatus({ meshtastic: { ...mesh, region_preset: "AU_915" } });
    auWrong.region = { ...auWrong.region!, code: "AU", meshtastic_preset: "ANZ" };
    expect(loraMismatches(auWrong, null, null, null, [])).toEqual([{ kind: "meshtastic", preset: "AU_915", expected: "ANZ" }]);
    // No expected preset (region without one, or an older agent): no chip.
    const none = makeStatus({ meshtastic: mesh });
    none.region = { ...none.region!, meshtastic_preset: null };
    expect(loraMismatches(none, IN_ROW, null, null, [])).toEqual([]);
  });

  it("flags an explicit LoRa region that differs from the country setting", () => {
    const explicit = makeStatus();
    explicit.region = { ...explicit.region!, source: "lora.region" };
    const table = [IN_ROW, { ...IN_ROW, code: "US" }, { ...IN_ROW, code: "EU" }];
    expect(loraMismatches(explicit, IN_ROW, "us", table, [])).toEqual([{ kind: "country", country: "US", code: "IN" }]);
    // Following the country setting never disagrees with it.
    expect(loraMismatches(makeStatus(), IN_ROW, "US", table, [])).toEqual([]);
  });

  it("compares the plan a country resolves to, not the raw country code", () => {
    const table = [IN_ROW, { ...IN_ROW, code: "EU", plan_id: "EU868" }];
    const euExplicit = makeStatus();
    euExplicit.region = { ...euExplicit.region!, code: "EU", source: "lora.region" };
    // Germany resolves to the EU plan: no chip.
    expect(loraMismatches(euExplicit, null, "DE", table, [])).toEqual([]);
    // India resolves to IN, which is not the explicit EU region: chip.
    expect(loraMismatches(euExplicit, null, "IN", table, [])).toEqual([{ kind: "country", country: "IN", code: "EU" }]);
    // A country the table cannot resolve, or no table yet: no comparison.
    expect(loraMismatches(euExplicit, null, "BR", table, [])).toEqual([]);
    expect(loraMismatches(euExplicit, null, "IN", null, [])).toEqual([]);
    expect(countryPlanCode("fr", table)).toBe("EU");
  });

  it("renders the advisory chips under the region line", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <LoraLaneView
          status={makeStatus()}
          regions={[IN_ROW]}
          beacons={[]}
          now={NOW}
          fetchedAt={NOW}
          writeLock={null}
          applying={false}
          onApply={() => {}}
          elrsModules={[mod("m1", "FCC915")]}
        />
      </NextIntlClientProvider>,
    );
    const list = screen.getByRole("list", { name: "Region advisories" });
    expect(list.textContent).toContain("ELRS module m1 is FCC915, region IN expects IN866");
  });
});

describe("LoraTab not fitted", () => {
  it("renders the not-fitted state for present:false, never numbers", () => {
    useLoraStore.setState({
      loraFor: "http://gs.example.test",
      status: { ...makeStatus(), present: false, region: null, channel: null, governor: null, tx: null, rx: null, meshtastic: null },
    });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <LoraTab nodeDeviceId="gs-1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("No LoRa module fitted")).toBeTruthy();
    expect(screen.queryByRole("group", { name: /Duty cycle/ })).toBeNull();
    useLoraStore.getState().clear();
  });
});
