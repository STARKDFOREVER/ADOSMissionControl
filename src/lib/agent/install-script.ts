/**
 * Single source for the ADOS Agent install one-liner.
 *
 * Every surface that shows an install command (Flash Tool catalog, pairing
 * flow, disconnected strip, error copy) builds it here. The command runs
 * the installer script from `main`, which then fetches signed release
 * binaries. `curl -f` makes a 404 fail instead of piping an error page
 * into bash.
 *
 * Only flags the installer actually parses are emitted.
 *
 * @license GPL-3.0-only
 */

import type { KnownNodeProfile } from "@/lib/nodes/node-profile";

export const AGENT_INSTALL_SCRIPT_URL =
  "https://raw.githubusercontent.com/altnautica/ADOSDroneAgent/main/scripts/install.sh";

export interface AgentInstallOptions {
  /** The installer normalizes the `ground-station` spelling; every other
   * profile passes through as spelled. */
  profile?: KnownNodeProfile;
  pairCode?: string;
  channel?: "stable" | "edge";
  version?: string;
  upgrade?: boolean;
}

export function buildAgentInstallCommand(o: AgentInstallOptions = {}): string {
  const args: string[] = [];
  if (o.upgrade) args.push("--upgrade");
  if (o.profile) args.push("--profile", o.profile);
  if (o.channel) args.push("--channel", o.channel);
  if (o.version) args.push("--version", o.version);
  if (o.pairCode) args.push("--pair", o.pairCode);
  const base = `curl -fsSL ${AGENT_INSTALL_SCRIPT_URL} | sudo bash`;
  return args.length > 0 ? `${base} -s -- ${args.join(" ")}` : base;
}

export const AGENT_INSTALL_CMD = buildAgentInstallCommand();
export const AGENT_INSTALL_GROUND_CMD = buildAgentInstallCommand({
  profile: "ground-station",
});
