/**
 * @module api/ground-station/mesh-source
 * @description Resolves the client the Mesh & RX surface (role picker, mesh
 * health / gateways, distributed RX, receiver pairing window) talks to.
 *
 * Off demo this is exactly `groundStationApiFromAgent`. In demo that returns
 * null (the demo agent URL has no ground-station REST endpoint), which left the
 * mesh surface unable to tell that the seeded role belongs to the node it is
 * rendered for and every mesh control inert. The demo installs an in-memory
 * mesh client here instead; it lives under `src/mock/` and reaches this module
 * only through the demo seed, so no production path imports demo data.
 * @license GPL-3.0-only
 */

import { isDemoMode } from "@/lib/utils";
import { groundStationApiFromAgent, type GroundStationApi } from "../ground-station-api";

let demoMeshApi: GroundStationApi | null = null;

/** Install (or clear) the demo mesh client. Called only by the demo seed. */
export function setDemoMeshApi(api: GroundStationApi | null): void {
  demoMeshApi = api;
}

/**
 * @returns The mesh client for this agent connection: the demo mesh client in
 *   demo mode, else the agent's ground-station REST client. Null with no agent
 *   URL, like `groundStationApiFromAgent`.
 */
export function meshApiFromAgent(
  agentUrl: string | null,
  apiKey: string | null,
): GroundStationApi | null {
  if (!agentUrl) return null;
  // DEMO-MODE BRANCH (gated on isDemoMode, real fleets unaffected).
  if (isDemoMode()) return demoMeshApi;
  return groundStationApiFromAgent(agentUrl, apiKey);
}
