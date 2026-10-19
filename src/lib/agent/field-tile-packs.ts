/**
 * @module field-tile-packs
 * @description Wire contract and lookup for the vector tile packs a ground
 * station serves over the LAN (`/api/v1/ground-station/tiles`).
 * @license GPL-3.0-only
 */

import { z } from "zod";
import { resolveLanAgent } from "@/lib/agent/resolve-agent";
import { agentRequest } from "@/lib/agent/agent-client/transport";
import { fetchVersionInfo, agentSupports } from "@/lib/agent/agent-client/version-cache";

/** Capability an agent advertises when it serves field tile packs. */
export const TILE_PACK_CAPABILITY = "tiles.pack";

const FieldTilePackSchema = z.object({
  name: z.string(),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  minzoom: z.number(),
  maxzoom: z.number(),
  tile_type: z.enum(["mvt", "png", "jpg", "webp", "unknown"]),
  usable: z.boolean(),
  size_bytes: z.number(),
  etag: z.string(),
});
const FieldTilePackListSchema = z.object({ packs: z.array(FieldTilePackSchema) });

export type FieldTilePack = z.infer<typeof FieldTilePackSchema>;

/**
 * Ask each paired ground station in turn for its packs; the first that
 * advertises the capability and answers wins. Null when none does, including
 * on an HTTPS origin, where `resolveLanAgent` refuses the plain-HTTP LAN host.
 */
export async function findFieldTileSource(
  deviceIds: readonly string[],
  signal: AbortSignal,
): Promise<{ baseUrl: string; apiKey: string; packs: FieldTilePack[] } | null> {
  for (const deviceId of deviceIds) {
    const agent = resolveLanAgent(deviceId);
    if (!agent) continue;
    const ctx = { baseUrl: agent.agentUrl, apiKey: agent.apiKey };
    try {
      if (!agentSupports(await fetchVersionInfo(ctx), TILE_PACK_CAPABILITY)) continue;
      const list = await agentRequest(ctx, "/api/v1/ground-station/tiles", { schema: FieldTilePackListSchema, signal });
      return { baseUrl: agent.agentUrl, apiKey: agent.apiKey, packs: list.packs };
    } catch {
      // Unreachable or refused: try the next ground station.
    }
  }
  return null;
}
