/**
 * @module components/mcp/mcp-shared
 * @description Scope presets and the connect recipe for the MCP credential
 * console. A preset maps to the scope set minted into the credential; the gate
 * on the server (and the backend) still governs every call the AI client makes.
 * @license GPL-3.0-only
 */

import type { ScopeContext } from "./mcp-scope-model";

/**
 * The scope / safety-class vocabulary the whole MCP tab shares. `read`,
 * `safe_write`, and `admin` are the default (unelevated) classes; `flight`,
 * `destructive`, and `secret_read` are elevated (default-off, warned).
 */
export const SAFETY_CLASSES = [
  "read",
  "safe_write",
  "admin",
  "flight",
  "destructive",
  "secret_read",
] as const;

export type SafetyClass = (typeof SAFETY_CLASSES)[number];

/** The elevated classes — always default-off at mint, color-warned in the UI. */
export const ELEVATED_SCOPES: readonly SafetyClass[] = ["flight", "destructive", "secret_read"];

/**
 * Tailwind badge classes per safety class. Single source of truth reused by the
 * tools catalog, plugin detail, and credential surfaces (extracted so a class's
 * colour is defined once). Fall back to {@link SAFETY_CLASS_BADGE_FALLBACK}.
 */
export const SAFETY_CLASS_BADGE: Record<string, string> = {
  read: "bg-status-success/15 text-status-success",
  safe_write: "bg-accent-primary/15 text-accent-primary",
  admin: "bg-status-warning/15 text-status-warning",
  flight: "bg-status-error/15 text-status-error",
  destructive: "bg-status-error/20 text-status-error",
  secret_read: "bg-bg-tertiary text-text-secondary",
};

export const SAFETY_CLASS_BADGE_FALLBACK = "bg-bg-tertiary text-text-secondary";

/** The badge classes for a safety class, falling back for an unknown class. */
export function safetyClassBadge(safetyClass: string): string {
  return SAFETY_CLASS_BADGE[safetyClass] ?? SAFETY_CLASS_BADGE_FALLBACK;
}

/**
 * The badge classes for a plugin-tool safety class. The agent spells the
 * flight class `flight_action`; both the MCP plugin detail and the install
 * pop-up's tools section badge it as `flight`. An absent class falls back to
 * the neutral badge.
 */
export function toolSafetyClassBadge(safetyClass: string | undefined): string {
  return safetyClassBadge(
    safetyClass === "flight_action" ? "flight" : (safetyClass ?? ""),
  );
}

/** Lifecycle state of a minted MCP credential. Only `active` can call a tool. */
export type McpCredentialStatus = "active" | "revoked" | "expired";

/**
 * The one status check every MCP surface uses (list, overview, sidebar badge,
 * catalog picker, detail drawer): revoked wins, then an expiry at or before
 * `now`, else active.
 */
export function credentialStatus(
  row: { revokedAt: number | null; expiresAt: number | null },
  now: number,
): McpCredentialStatus {
  if (row.revokedAt != null) return "revoked";
  if (row.expiresAt != null && row.expiresAt <= now) return "expired";
  return "active";
}

/**
 * The reach context every minted credential is evaluated in. A minted
 * credential only connects through the fleet relay (`--target fleet`), so
 * agent-mode-only tools are unreachable and flight enforcement is off.
 */
export const MINTED_CREDENTIAL_REACH: ScopeContext = { flightEnforced: false, fleetMode: true };

/** The scope set each preset mints. Read-only, Operate (the default), Full. */
export const SCOPE_PRESETS: Record<string, string[]> = {
  read: ["read"],
  operate: ["read", "safe_write", "admin"],
  full: ["read", "safe_write", "admin", "flight", "destructive"],
};

/**
 * The presets offered in the picker. `full` (flight + destructive) is held back
 * until the flight plane lands, so the console never mints a flight-scoped
 * credential the server cannot yet honor. Re-add "full" here once flight tools
 * are registered and gated by their confirm flow.
 */
export const SCOPE_PRESET_ORDER = ["read", "operate"] as const;

/** The public repo the operator clones to run the server (clone-and-run, no npm). */
export const ADOS_MCP_REPO = "https://github.com/altnautica/ADOS-MCP.git";

/** Stands in for the operator's local clone path; the setup script prints the real one. */
export const CLONE_PATH_PLACEHOLDER = "<path-to>/ADOS-MCP";

/** The public container image the Docker runtime runs (multi-arch, GHCR). */
export const ADOS_MCP_IMAGE = "ghcr.io/altnautica/ados-mcp:latest";

/**
 * How the operator runs the server: `docker` pulls the ready-built image (needs
 * only Docker), `source` clones and builds the repo (needs Node.js, git, pnpm).
 */
export type McpRuntime = "docker" | "source";

/** The host data dir mounted into the container, shell form (`$HOME` expands). */
const MOUNT_SHELL = '"$HOME/.ados/mcp:/home/node/.ados/mcp"';
/** The same mount for `.mcp.json` args (the client expands `${HOME}`). */
const MOUNT_JSON = "${HOME}/.ados/mcp:/home/node/.ados/mcp";

/**
 * The shell launch command for a runtime. Docker forwards each named env var
 * with a bare `-e NAME` (the value comes from the client-set environment, never
 * the `docker` argv) and mounts `~/.ados/mcp` so the audit trail persists and
 * this tab's live activity can tail it.
 */
function launchCmd(runtime: McpRuntime, envNames: readonly string[]): string {
  if (runtime === "source") return `node ${CLONE_PATH_PLACEHOLDER}/dist/index.js`;
  return ["docker run -i --rm", ...envNames.map((n) => `-e ${n}`), `-v ${MOUNT_SHELL}`, ADOS_MCP_IMAGE].join(" ");
}

/** The `.mcp.json` `command` + leading `args` for a runtime (see {@link launchCmd}). */
function launchJson(runtime: McpRuntime, envNames: readonly string[]): { command: string; args: string[] } {
  if (runtime === "source") return { command: "node", args: [`${CLONE_PATH_PLACEHOLDER}/dist/index.js`] };
  return {
    command: "docker",
    args: ["run", "-i", "--rm", ...envNames.flatMap((n) => ["-e", n]), "-v", MOUNT_JSON, ADOS_MCP_IMAGE],
  };
}

/** The one-time block that creates the data dir and pulls the image. */
export function dockerPullRecipe(): string {
  return `mkdir -p ~/.ados/mcp\ndocker pull ${ADOS_MCP_IMAGE}`;
}

/**
 * The host a containerised server should dial. A `.local` mDNS name does not
 * resolve inside a container on Linux bridge networking, so when the node's
 * IPv4 is known it replaces the hostname (protocol and port kept); otherwise
 * the hostname is returned unchanged.
 */
export function dockerReachableHost(hostname: string, ipv4?: string): string {
  if (!ipv4) return hostname;
  try {
    const url = new URL(hostname);
    url.hostname = ipv4;
    return url.origin;
  } catch {
    return hostname;
  }
}

/** The clone + build block a user runs once to get the server locally. */
export function cloneAndBuildRecipe(): string {
  return `git clone ${ADOS_MCP_REPO}\ncd ADOS-MCP\n./scripts/setup.sh`;
}

/**
 * The `claude mcp add` command that registers the server with the credential
 * in the client environment (`-e`, so it is not left in the shell).
 */
export function connectRecipe(credential: string, runtime: McpRuntime = "source"): string {
  return `claude mcp add ados -e ADOS_MCP_TOKEN=${credential} -- ${launchCmd(runtime, ["ADOS_MCP_TOKEN"])} --target fleet --gcs prod`;
}

/**
 * A project-scoped `.mcp.json` entry an operator commits to a project so Claude
 * Code (and other MCP clients that read `.mcp.json`) launch the server with the
 * credential set. An alternative to the `claude mcp add` command.
 */
export function mcpJsonSnippet(credential: string, runtime: McpRuntime = "source"): string {
  const launch = launchJson(runtime, ["ADOS_MCP_TOKEN"]);
  return JSON.stringify(
    {
      mcpServers: {
        ados: {
          command: launch.command,
          args: [...launch.args, "--target", "fleet", "--gcs", "prod"],
          env: { ADOS_MCP_TOKEN: credential },
        },
      },
    },
    null,
    2,
  );
}

// --- LOCAL-FIRST (agent-mode) recipes (local-first) -----------------------------
//
// The LAN-direct path is the primary, default way to connect: the server runs on
// the operator's own machine and reaches ONE drone directly over the LAN with the
// drone's own pairing key — no Mission Control sign-in, no cloud, no minted
// credential. `host` is the agent's reachable address (the LocalNode.hostname,
// e.g. `http://drone.local:8080`); `apiKey` is that node's pairing key. The cloud
// (`--target fleet`) recipes above are the opt-in "manage from anywhere" path.

/** The LAN-direct `claude mcp add` command for one drone (no login, no cloud). */
export function localConnectRecipe(host: string, apiKey: string, runtime: McpRuntime = "source"): string {
  return `claude mcp add ados -e ADOS_MCP_AGENT_KEY=${apiKey} -- ${launchCmd(runtime, ["ADOS_MCP_AGENT_KEY"])} --target agent ${host}`;
}

/** The shell line that sets a secret the `.mcp.json` snippets read by reference. */
export function envExportLine(name: string, value: string): string {
  return `export ${name}=${value}`;
}

/**
 * A project-scoped `.mcp.json` for the LAN-direct (agent-mode) single-drone
 * path. The pairing key is referenced as `${ADOS_MCP_AGENT_KEY}` and expanded
 * from the environment by the client, so the file itself holds no secret and
 * is safe to commit.
 */
export function localMcpJsonSnippet(host: string, runtime: McpRuntime = "source"): string {
  const launch = launchJson(runtime, ["ADOS_MCP_AGENT_KEY"]);
  return JSON.stringify(
    {
      mcpServers: {
        ados: {
          command: launch.command,
          args: [...launch.args, "--target", "agent", host],
          env: { ADOS_MCP_AGENT_KEY: "${ADOS_MCP_AGENT_KEY}" },
        },
      },
    },
    null,
    2,
  );
}

/** The one-line LAN-direct check that confirms the drone answers, no MCP client.
 * The Docker form is a one-shot run (no `-i`), with the key set inline. */
export function localVerifyRecipe(host: string, apiKey: string, runtime: McpRuntime = "source"): string {
  if (runtime === "docker") {
    return `docker run --rm -e ADOS_MCP_AGENT_KEY=${apiKey} ${ADOS_MCP_IMAGE} --target agent ${host} --verify`;
  }
  return `ADOS_MCP_AGENT_KEY=${apiKey} node ${CLONE_PATH_PLACEHOLDER}/dist/index.js --target agent ${host} --verify`;
}

// --- LOCAL-FIRST multi-drone fleet (local-first) --------------------------------
//
// For a whole LAN fleet the operator exports an `ados-fleet.json` (every paired
// drone's host + its own pairing key) from the wizard and points the server at it
// with `--target local-fleet <path>`. No cloud, no login; the keys live in the
// operator's own file. The default save location is under ~/.ados/mcp/.

/** The default local-fleet file path shown in the recipe. */
export const DEFAULT_FLEET_PATH = "~/.ados/mcp/fleet.json";
/** The filename the download uses (the operator saves it to DEFAULT_FLEET_PATH). */
export const LOCAL_FLEET_FILENAME = "ados-fleet.json";

/** One drone as written into the exported fleet file. */
export interface FleetFileNode {
  deviceId: string;
  name?: string;
  host: string;
  apiKey: string;
  profile?: string;
}

/** Serialize the `ados-fleet.json` the operator downloads and saves locally. */
export function fleetFileContents(nodes: FleetFileNode[]): string {
  const doc = {
    version: 1,
    nodes: nodes.map((n) => ({
      deviceId: n.deviceId,
      ...(n.name ? { name: n.name } : {}),
      host: n.host,
      apiKey: n.apiKey,
      ...(n.profile ? { profile: n.profile } : {}),
    })),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Options shared by the fleet recipes. `discover` = the connector also browses the
 * LAN and auto-adopts new UNPAIRED drones (the `--discover` opt-in). */
export interface FleetRecipeOpts {
  discover?: boolean;
}

const discoverFlag = (o: FleetRecipeOpts): string => (o.discover ? " --discover" : "");

/**
 * The whole fleet as a base64 blob for the `ADOS_MCP_FLEET` env — the "control all
 * my drones in ONE command, no file" hand-off (each drone's host + pairing key,
 * exactly as the single-drone recipe carries one key in `ADOS_MCP_AGENT_KEY`).
 * Unicode-safe base64 (btoa is Latin1-only), chunked so a large fleet never
 * overflows the call stack; the connector decodes it with Buffer.from(…,"base64").
 */
export function fleetEnvValue(nodes: FleetFileNode[]): string {
  const bytes = new TextEncoder().encode(fleetFileContents(nodes));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The ONE `claude mcp add` command that controls the whole fleet — no file: every
 * drone's host + key rides in `ADOS_MCP_FLEET`. */
export function localFleetEnvRecipe(
  fleetB64: string,
  opts: FleetRecipeOpts = {},
  runtime: McpRuntime = "source",
): string {
  return `claude mcp add ados -e ADOS_MCP_FLEET=${fleetB64} -- ${launchCmd(runtime, ["ADOS_MCP_FLEET"])} --target local-fleet${discoverFlag(opts)}`;
}

/** The `.mcp.json` equivalent of the no-file, whole-fleet command. The fleet
 * blob carries every drone's pairing key, so it is referenced as
 * `${ADOS_MCP_FLEET}` and expanded from the environment, never embedded. */
export function localFleetEnvJsonSnippet(
  opts: FleetRecipeOpts = {},
  runtime: McpRuntime = "source",
): string {
  const launch = launchJson(runtime, ["ADOS_MCP_FLEET"]);
  const args = [...launch.args, "--target", "local-fleet"];
  if (opts.discover) args.push("--discover");
  return JSON.stringify(
    { mcpServers: { ados: { command: launch.command, args, env: { ADOS_MCP_FLEET: "${ADOS_MCP_FLEET}" } } } },
    null,
    2,
  );
}

/**
 * The `claude mcp add` command for a whole LAN fleet from a FILE (keys in the
 * file). With the Docker runtime `fleetPath` is ignored and no path is emitted:
 * the container reads its default `~/.ados/mcp/fleet.json` from the mounted
 * host `~/.ados/mcp`, so save the file at {@link DEFAULT_FLEET_PATH}.
 */
export function localFleetConnectRecipe(
  fleetPath = DEFAULT_FLEET_PATH,
  opts: FleetRecipeOpts = {},
  runtime: McpRuntime = "source",
): string {
  const path = runtime === "docker" ? "" : ` ${fleetPath}`;
  return `claude mcp add ados -- ${launchCmd(runtime, [])} --target local-fleet${path}${discoverFlag(opts)}`;
}

/** The one-line check that confirms the fleet answers (per-node ✓/✗), no client.
 * The Docker form is a one-shot run that reads the mounted default fleet file. */
export function localFleetVerifyRecipe(
  fleetPath = DEFAULT_FLEET_PATH,
  runtime: McpRuntime = "source",
): string {
  if (runtime === "docker") {
    return `docker run --rm -v ${MOUNT_SHELL} ${ADOS_MCP_IMAGE} --target local-fleet --verify`;
  }
  return `node ${CLONE_PATH_PLACEHOLDER}/dist/index.js --target local-fleet ${fleetPath} --verify`;
}
