/**
 * @module video/hero-profile-hold
 * @description Holds a LAN-direct drone on the `hero` video profile while a
 * detail surface plays it (the focused drone's Agent-tab feed, the Overview Fly
 * pane, the cockpit canvas), and lets go when the last one closes.
 *
 * A WFB drone boots on `thumbnail` (320x180 at 1 fps) so a fleet powering up
 * together does not flood the shared channel, and waits to be promoted. The
 * hold is a lease on the agent's `POST /api/video/profile`:
 * - this tab takes the lease under one stable holder id, renews it at half the
 *   lease, and releases it with `DELETE` when the last surface closes, so a
 *   closed or crashed tab expires on its own and never strands the drone on
 *   hero;
 * - the surfaces sharing the one session share one lease, counted per agent;
 * - the release waits {@link HERO_RELEASE_GRACE_MS}, so moving between two
 *   detail surfaces does not respawn the encoder twice;
 * - a ground station is never promoted.
 * An agent that predates leases answers without a `leases` list; there the
 * hold falls back to a plain set, promoting only a drone it saw on
 * `thumbnail` and demoting only what it promoted.
 * Fleet tiles never take a hold: a grid stays on the fleet's allocation.
 *
 * @license GPL-3.0-only
 */

import type { AgentClient } from "@/lib/agent/client";

/** The agent calls a hold makes; the connected `AgentClient` in practice. */
export type HeroProfileClient = Pick<
  AgentClient,
  "getFullStatus" | "setVideoProfile" | "releaseVideoProfile"
>;

/** How long the last released hold waits before releasing the lease. */
export const HERO_RELEASE_GRACE_MS = 5_000;

/** The lease this tab asks for; renewed at half of it. */
export const HERO_LEASE_S = 30;
export const HERO_RENEW_MS = (HERO_LEASE_S * 1000) / 2;

const HOLDER_KEY = "ados.heroProfileHolder";

function newHolderId(): string {
  const raw =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
  return `mc:${raw}`;
}

let holderId: string | undefined;

/** One holder id per browser tab, stable across reloads of that tab. */
export function heroHolderId(): string {
  if (holderId) return holderId;
  try {
    const stored = sessionStorage.getItem(HOLDER_KEY);
    if (stored && /^[A-Za-z0-9._:-]{1,64}$/.test(stored)) {
      holderId = stored;
      return stored;
    }
    holderId = newHolderId();
    sessionStorage.setItem(HOLDER_KEY, holderId);
  } catch {
    holderId ??= newHolderId();
  }
  return holderId;
}

/** How this hold ended up holding the drone. */
type Outcome = "lease" | "legacy" | "none";

interface Hold {
  count: number;
  client: HeroProfileClient;
  outcome: Promise<Outcome>;
  renewTimer: ReturnType<typeof setInterval> | undefined;
  releaseTimer: ReturnType<typeof setTimeout> | undefined;
}

const holds = new Map<string, Hold>();

async function promote(client: HeroProfileClient, holder: string): Promise<Outcome> {
  try {
    const full = await client.getFullStatus();
    if (!full || full.profile === "ground-station") return "none";
    const observed = full.telemetry?.video_profile;
    // An agent that does not report its profile predates leases too.
    if (observed !== "hero" && observed !== "thumbnail") return "none";
    const applied = await client.setVideoProfile("hero", {
      holder,
      leaseS: HERO_LEASE_S,
    });
    if (Array.isArray(applied?.leases)) return "lease";
    // A pre-lease agent applied a plain set, which was a no-op on a drone
    // already on hero, so only a promotion from thumbnail is ours to undo.
    return observed === "thumbnail" ? "legacy" : "none";
  } catch {
    // A rig with no video pipeline (503), a ground station (404) or a
    // refused request: the view keeps playing whatever profile is live.
    return "none";
  }
}

/**
 * Take a hero hold on the agent at `agentUrl`. Returns the release; calling it
 * more than once releases once.
 */
export function acquireHeroProfile(agentUrl: string, client: HeroProfileClient): () => void {
  const holder = heroHolderId();
  let hold = holds.get(agentUrl);
  if (hold) {
    clearTimeout(hold.releaseTimer);
    hold.releaseTimer = undefined;
    hold.count += 1;
  } else {
    const created: Hold = {
      count: 1,
      client,
      outcome: promote(client, holder),
      renewTimer: undefined,
      releaseTimer: undefined,
    };
    void created.outcome.then((outcome) => {
      if (outcome !== "lease" || holds.get(agentUrl) !== created) return;
      created.renewTimer = setInterval(() => {
        void created.client
          .setVideoProfile("hero", { holder, leaseS: HERO_LEASE_S })
          .catch(() => {});
      }, HERO_RENEW_MS);
    });
    holds.set(agentUrl, created);
    hold = created;
  }
  const held = hold;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.count -= 1;
    if (held.count > 0) return;
    held.releaseTimer = setTimeout(() => {
      if (held.count > 0 || holds.get(agentUrl) !== held) return;
      holds.delete(agentUrl);
      clearInterval(held.renewTimer);
      void held.outcome
        .then((outcome) => {
          if (outcome === "lease") return held.client.releaseVideoProfile(holder);
          if (outcome === "legacy") return held.client.setVideoProfile("thumbnail");
          return undefined;
        })
        .catch(() => {});
    }, HERO_RELEASE_GRACE_MS);
  };
}
