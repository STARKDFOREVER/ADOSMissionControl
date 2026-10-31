import type { CommandAgentSummary } from "@/hooks/use-command-agent-fleet";
import type { StatusLevel } from "@/lib/status-level";
import { agentEffProfile, type EffProfile } from "@/lib/nodes/node-profile";

// A tile that has been "connecting" longer than this is wedged. Force a
// fresh session attempt rather than spinning the placeholder forever.
export const TILE_CONNECT_TIMEOUT_MS = 15_000;

export function pct(value: number | null): string {
  return value == null ? "--" : `${Math.round(value)}%`;
}

/**
 * Pick the presentation profile for a fleet tile from the summary, mirroring
 * the node-detail `effectiveNodeProfile` view-model (which keys on a
 * `SurfaceContext` this fleet tile does not have). A `drone`-profile node with
 * a live flight controller but no companion computer (no CPU/Mem/Temp and no
 * camera pipeline) is a bare flight controller, surfaced as its own kind.
 */
export function tileEffProfile(agent: CommandAgentSummary): EffProfile {
  const profile = agentEffProfile(agent.profile);
  if (profile !== "drone") return profile;
  const noCompanion =
    agent.system.cpuPercent == null &&
    agent.system.memoryPercent == null &&
    agent.system.temperature == null;
  const noVideo = !agent.video.whepUrl && !agent.video.active;
  if (agent.system.fcReachable && noCompanion && noVideo) {
    return "flight-controller";
  }
  return "drone";
}

export function livenessLevel(liveness: CommandAgentSummary["liveness"]): StatusLevel {
  return liveness === "live" ? "good" : liveness === "stale" ? "serious" : "offline";
}
