import type { CSSProperties } from "react";
import { PROFILES, type AgentProfileId } from "@/lib/plugins/contracts.generated";

/** An agent profile id in the GCS spelling: the agent's `ground_station` is
 * hyphenated here; every other id is spelled as the agent spells it. */
type GcsProfileSpelling<P extends AgentProfileId> = P extends "ground_station"
  ? "ground-station"
  : P;

/** Every profile an agent can run (the agent's canonical `PROFILES` list), in
 * the GCS spelling. */
export type KnownNodeProfile = GcsProfileSpelling<AgentProfileId>;

/**
 * The GCS node profile. `"unknown"` is a profile this build does not know — a
 * newer agent — and is never coerced onto a known one: it renders with a
 * neutral glyph and only the Agent surface. Drives node grouping, tab
 * selection and plugin targeting.
 */
export type NodeProfile = KnownNodeProfile | "unknown";

function gcsProfileSpelling(id: AgentProfileId): KnownNodeProfile {
  return id === "ground_station" ? "ground-station" : id;
}

/** Every profile an agent can run, in the GCS spelling, in canonical order. */
export const KNOWN_NODE_PROFILES: readonly KnownNodeProfile[] = PROFILES.map(gcsProfileSpelling);

/** Both spellings of every agent profile id → its GCS spelling. */
const WIRE_PROFILES: Readonly<Record<string, KnownNodeProfile>> = Object.fromEntries(
  PROFILES.flatMap((id) => [
    [id, gcsProfileSpelling(id)],
    [gcsProfileSpelling(id), gcsProfileSpelling(id)],
  ]),
);

// Unknown profile strings already warned about, so a newer agent does not
// spam the console at heartbeat rate.
const seenUnknownProfiles = new Set<string>();

/**
 * Parse a wire profile (either spelling) into a {@link NodeProfile}. A missing
 * field is a legacy agent that predates profiles and reads as `"drone"`; any
 * other unrecognised value reads as `"unknown"` and warns once per value.
 */
export function parseNodeProfile(raw: unknown): NodeProfile {
  if (raw === undefined || raw === null || raw === "") return "drone";
  if (typeof raw === "string" && Object.hasOwn(WIRE_PROFILES, raw)) {
    return WIRE_PROFILES[raw];
  }
  const key = String(raw);
  if (typeof console !== "undefined" && !seenUnknownProfiles.has(key)) {
    seenUnknownProfiles.add(key);
    console.warn("[node-profile] unknown agent profile %s", key);
  }
  return "unknown";
}

/**
 * The effective, view-model node profile used to shape every context-aware
 * surface (hero, overview, sidebar row, fleet card). It is derived from the
 * real `drone.profile` plus liveness — a flight-controller is a `drone` node
 * with no paired agent, surfaced here as its own kind rather than a degraded
 * drone, and a compute node presents as a workstation. The tab registry still
 * keys on the real `drone.profile`; this is a presentation discriminator only.
 */
export type EffProfile =
  | "drone"
  | "flight-controller"
  | "ground-station"
  | "workstation"
  | "visor"
  | "unknown";

/** The presentation profile for a node with a companion agent (not a bare
 * flight controller). */
export function agentEffProfile(profile: NodeProfile | undefined): EffProfile {
  switch (profile) {
    case "ground-station":
    case "workstation":
    case "visor":
    case "unknown":
      return profile;
    case "compute":
      return "workstation";
    default:
      return "drone";
  }
}

/**
 * Whether a node shows flight-controller surfaces (FC reading, FC link,
 * hardware/FC panels). A drone always does. A Visor does while its hub is
 * reachable as a MAVLink flight controller (the stage-A sensor hub); a Visor
 * without one is a host node. Every FC-bearing surface asks this one rule.
 */
export function showsFcSurfaces(profile: NodeProfile, fcReachable: boolean): boolean {
  return profile === "drone" || (profile === "visor" && fcReachable);
}

/**
 * Whether a node is a vehicle the GCS may fly: arm/disarm, mode changes,
 * takeoff/land/RTL, guided and mission commands, uploads, motor and servo
 * tests, stick override. A Visor's flight controller is a sensor hub, never
 * a vehicle, so a Visor keeps only the read and configuration FC surfaces.
 * Every flight action, in the UI and at the protocol, asks this one rule.
 * A node whose profile is not read yet (a bare FC) stays flyable.
 */
export function nodeCanFly(profile: NodeProfile | null | undefined): boolean {
  return profile !== "visor";
}

/** A ground station's role as every node surface labels it. */
export type GroundRoleKey = "direct" | "relay" | "receiver" | "unknown";

/**
 * The role a ground station has actually reported. An unset or not-yet-
 * reported role, or a value this build does not know, reads as unknown —
 * never as "direct". Every surface that labels the role (sidebar badge, row
 * subtitle, hover card) resolves it here so they cannot disagree.
 */
export function groundRoleKey(role: string | null | undefined): GroundRoleKey {
  return role === "direct" || role === "relay" || role === "receiver"
    ? role
    : "unknown";
}

/** The CSS custom property holding each profile's identity accent hue. */
export const NODE_ACCENT_VAR: Record<EffProfile, string> = {
  drone: "--node-accent-drone",
  "flight-controller": "--node-accent-fc",
  "ground-station": "--node-accent-gs",
  workstation: "--node-accent-work",
  visor: "--node-accent-visor",
  unknown: "--node-accent-unknown",
};

/** The curated, theme-safe personalization swatches (their CSS var suffixes). */
export const NODE_SWATCHES = [
  "slate",
  "blue",
  "cyan",
  "teal",
  "green",
  "amber",
  "orange",
  "red",
  "pink",
  "purple",
] as const;

export type NodeSwatch = (typeof NODE_SWATCHES)[number];

/** The CSS var for a personalization swatch. */
export function swatchVar(swatch: NodeSwatch): string {
  return `--node-swatch-${swatch}`;
}

/**
 * Build an inline tint from an identity hue CSS var, blended into the live
 * theme surface so it keeps contrast across every theme (no per-theme table).
 * `bg` tints the tile wash; `border` tints the accent rule. Values are
 * percentages of the hue mixed over the surface.
 */
export function tintStyle(
  cssVar: string,
  opts?: { bg?: number; border?: number; surface?: string },
): CSSProperties {
  const bg = opts?.bg ?? 12;
  const border = opts?.border ?? 40;
  const surface = opts?.surface ?? "var(--alt-bg-secondary)";
  return {
    backgroundColor: `color-mix(in oklab, var(${cssVar}) ${bg}%, ${surface})`,
    borderColor: `color-mix(in oklab, var(${cssVar}) ${border}%, transparent)`,
  };
}

/** The tint for a profile's identity accent. */
export function profileTint(
  profile: EffProfile,
  opts?: { bg?: number; border?: number; surface?: string },
): CSSProperties {
  return tintStyle(NODE_ACCENT_VAR[profile], opts);
}
