/**
 * A fleet tile resolves its node's pairing key and sends it only to the node's
 * own `:8080` front.
 *
 * @license GPL-3.0-only
 */

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { usePairedWhepKey } from "@/hooks/use-whep-key";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";

const initialLocal = useLocalNodesStore.getState();
const initialPairing = usePairingStore.getState();

function seedLocal(deviceId: string, apiKey: string) {
  useLocalNodesStore.setState({
    nodes: [{ deviceId, apiKey, hostname: "http://192.168.1.50:8080", name: "n", pairedAt: 1 }],
  } as never);
}

describe("usePairedWhepKey", () => {
  afterEach(() => {
    useLocalNodesStore.setState(initialLocal, true);
    usePairingStore.setState(initialPairing, true);
  });

  it("returns the local pairing key for the node's own front", () => {
    seedLocal("dev-1", "local-key");
    const { result } = renderHook(() =>
      usePairedWhepKey("dev-1", "http://192.168.1.50:8080/whep", "192.168.1.50"),
    );
    expect(result.current).toBe("local-key");
  });

  it("falls back to the cloud pairing record", () => {
    usePairingStore.setState({
      pairedDrones: [{ deviceId: "dev-2", apiKey: "cloud-key" }],
    } as never);
    const { result } = renderHook(() =>
      usePairedWhepKey("dev-2", "http://192.168.1.51:8080/whep", "192.168.1.51"),
    );
    expect(result.current).toBe("cloud-key");
  });

  it("withholds the key from an absolute URL on another host", () => {
    seedLocal("dev-1", "local-key");
    const { result } = renderHook(() =>
      usePairedWhepKey("dev-1", "http://cdn.example.com/main/whep", "192.168.1.50"),
    );
    expect(result.current).toBeNull();
  });
});
