/**
 * Render budget of the fleet projection with a 24-node fleet: a registry
 * bump that changes no fleet entry (positions streaming each frame) must not
 * hand consumers a new list or new row identities.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Profiler } from "react";
import { render, act } from "@testing-library/react";

import { useFleetNodes, type FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { useCommandFleetStore } from "@/stores/command-fleet-store";

const FLEET_SIZE = 24;
const FRAMES = 60;

function seedFleet() {
  const nodes = Array.from({ length: FLEET_SIZE }, (_, i) => ({
    deviceId: `dev-${i}`,
    name: `Node ${i}`,
    apiKey: "k",
    version: "1.0.0",
    mdnsHost: `node-${i}.local`,
    pairedAt: 1_000 + i,
    profile: "drone" as const,
    role: null,
  }));
  useLocalNodesStore.setState({ nodes: nodes as never });
  usePairingStore.setState({ pairedDrones: [] });
}

let lists: FleetNodeEntry[][] = [];
let commits = 0;

function Consumer() {
  const nodes = useFleetNodes();
  lists.push(nodes);
  return null;
}

beforeEach(() => {
  lists = [];
  commits = 0;
  seedFleet();
});

describe("useFleetNodes render budget (24 nodes)", () => {
  it("a registry bump with no entry change keeps the list and rows", () => {
    render(
      <Profiler id="fleet" onRender={() => { commits += 1; }}>
        <Consumer />
      </Profiler>,
    );
    const first = lists[lists.length - 1];
    expect(first).toHaveLength(FLEET_SIZE);
    const before = commits;

    for (let f = 0; f < FRAMES; f++) {
      act(() => {
        useNodeRegistryStore.setState((s) => ({ lastUpdate: (s.lastUpdate ?? 0) + 1 }));
      });
    }
    const last = lists[lists.length - 1];
    // Same list identity means memoised rows (and the list itself) stay put.
    expect(last).toBe(first);
    last.forEach((row, i) => expect(row).toBe(first[i]));
    // The relayed-only signature is unchanged, so consumers do not re-render.
    expect(commits - before).toBe(0);
  });

  it("a change to one node's live status replaces only that row", () => {
    render(<Consumer />);
    const first = lists[lists.length - 1];
    act(() => {
      useCommandFleetStore.setState((s) => ({
        cloudStatuses: { ...s.cloudStatuses, "dev-3": { fcConnected: true } as never },
      }));
    });
    const next = lists[lists.length - 1];
    expect(next).not.toBe(first);
    next.forEach((row, i) => {
      if (row.deviceId === "dev-3") expect(row).not.toBe(first[i]);
      else expect(row).toBe(first[i]);
    });
  });
});
