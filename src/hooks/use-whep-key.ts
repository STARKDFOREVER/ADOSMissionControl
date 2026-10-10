"use client";

/**
 * @module hooks/use-whep-key
 * @description The pairing key a WHEP player presents, resolved reactively so
 * a pairing that lands after mount re-dials with the key. Two reaches:
 * - {@link useConnectedWhepKey}: a surface showing the connected node (PiP
 *   inset, camera roster) uses the connection's own agent URL and key.
 * - {@link usePairedWhepKey}: a fleet tile showing any paired node uses that
 *   node's pairing record and the `:8080` front its WHEP URL resolves against.
 * Both send the key only to the node's own origin (see `whepKeyFor`).
 * @license GPL-3.0-only
 */

import { agentMediaBase } from "@/lib/agent/video-url";
import { whepKeyFor } from "@/lib/video/webrtc/whep-auth";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";

/** The connected node's key for `whepUrl`, or null off that node's origin. */
export function useConnectedWhepKey(whepUrl: string | null | undefined): string | null {
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  return whepKeyFor(whepUrl, agentUrl, apiKey);
}

/**
 * A paired node's key for `whepUrl`, or null. The browser-local pairing record
 * wins over the cloud-mediated one, as in `resolvePairedApiKey`. The origin the
 * key may travel to is the node's own front at `lastIp`, the base the fleet
 * view resolved the node's relative WHEP path against.
 */
export function usePairedWhepKey(
  deviceId: string,
  whepUrl: string | null | undefined,
  lastIp: string | undefined,
): string | null {
  const localKey = useLocalNodesStore(
    (s) => s.nodes.find((n) => n.deviceId === deviceId)?.apiKey || null,
  );
  const cloudKey = usePairingStore(
    (s) => s.pairedDrones.find((d) => d.deviceId === deviceId)?.apiKey || null,
  );
  return whepKeyFor(whepUrl, agentMediaBase(lastIp), localKey ?? cloudKey);
}
