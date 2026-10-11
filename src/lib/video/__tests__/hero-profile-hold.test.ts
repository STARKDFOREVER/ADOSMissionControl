/**
 * The hero hold takes a renewed lease under one per-tab holder, shares it
 * between surfaces, releases it after a grace, never promotes a ground
 * station, retries a rate-limited promotion while still held, and falls back
 * to a plain set on an agent without leases.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentHttpError } from "@/lib/agent/agent-client/transport";
import {
  acquireHeroProfile,
  HERO_LEASE_S,
  HERO_RATE_LIMIT_BACKOFF_MS,
  HERO_RELEASE_GRACE_MS,
  HERO_RENEW_MS,
  heroHolderId,
  type HeroProfileClient,
} from "@/lib/video/hero-profile-hold";

function fakeClient(
  videoProfile: string | undefined,
  { profile = "drone", leases = true }: { profile?: string; leases?: boolean } = {},
) {
  const applied = (p: "hero" | "thumbnail") => ({
    profile: p,
    width: 1280,
    height: 720,
    fps: 30,
    bitrate_kbps: 4000,
    ceiling_kbps: null,
    ...(leases ? { base_profile: "thumbnail", leases: [] } : {}),
  });
  const setVideoProfile = vi.fn(
    async (p: "hero" | "thumbnail", _lease?: { holder: string; leaseS: number }) => applied(p),
  );
  const releaseVideoProfile = vi.fn(async (_holder: string) => applied("thumbnail"));
  const getFullStatus = vi.fn(async () => ({
    profile,
    telemetry: videoProfile === undefined ? {} : { video_profile: videoProfile },
  }));
  const client = {
    getFullStatus,
    setVideoProfile,
    releaseVideoProfile,
  } as unknown as HeroProfileClient;
  return { client, getFullStatus, setVideoProfile, releaseVideoProfile };
}

/** Let the promote chain's awaits settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

let agentSeq = 0;
let agent = "";

describe("acquireHeroProfile", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    agentSeq += 1;
    agent = `http://agent-${agentSeq}.example.com:8080`;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses one valid holder id per tab", () => {
    const id = heroHolderId();
    expect(id).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
    expect(heroHolderId()).toBe(id);
  });

  it("leases hero, renews at half the lease, releases after the grace", async () => {
    const { client, setVideoProfile, releaseVideoProfile } = fakeClient("thumbnail");
    const release = acquireHeroProfile(agent, client);
    await settle();
    const lease = { holder: heroHolderId(), leaseS: HERO_LEASE_S };
    expect(setVideoProfile.mock.calls).toEqual([["hero", lease]]);
    expect(HERO_RENEW_MS).toBe((HERO_LEASE_S * 1000) / 2);
    await vi.advanceTimersByTimeAsync(HERO_RENEW_MS);
    expect(setVideoProfile.mock.calls).toEqual([["hero", lease], ["hero", lease]]);
    release();
    await vi.advanceTimersByTimeAsync(HERO_RELEASE_GRACE_MS - 1);
    expect(releaseVideoProfile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(releaseVideoProfile.mock.calls).toEqual([[heroHolderId()]]);
    await vi.advanceTimersByTimeAsync(HERO_RENEW_MS * 3);
    expect(setVideoProfile).toHaveBeenCalledTimes(2);
  });

  it("leases a drone already on hero so a later demotion does not stick", async () => {
    const { client, setVideoProfile } = fakeClient("hero");
    acquireHeroProfile(agent, client);
    await settle();
    expect(setVideoProfile).toHaveBeenCalledTimes(1);
  });

  it("never promotes a ground station or a status without the profile", async () => {
    const gs = fakeClient("thumbnail", { profile: "ground-station" });
    const old = fakeClient(undefined);
    acquireHeroProfile(agent, gs.client);
    acquireHeroProfile(`${agent}/old`, old.client);
    await settle();
    expect(gs.setVideoProfile).not.toHaveBeenCalled();
    expect(old.setVideoProfile).not.toHaveBeenCalled();
  });

  it("shares one lease between surfaces and keeps it while any holds it", async () => {
    const { client, setVideoProfile, releaseVideoProfile } = fakeClient("thumbnail");
    const a = acquireHeroProfile(agent, client);
    const b = acquireHeroProfile(agent, client);
    await settle();
    expect(setVideoProfile).toHaveBeenCalledTimes(1);
    a();
    a();
    await vi.advanceTimersByTimeAsync(HERO_RELEASE_GRACE_MS);
    expect(releaseVideoProfile).not.toHaveBeenCalled();
    b();
    await vi.advanceTimersByTimeAsync(HERO_RELEASE_GRACE_MS);
    expect(releaseVideoProfile).toHaveBeenCalledTimes(1);
  });

  it("a re-acquire inside the grace cancels the release", async () => {
    const { client, releaseVideoProfile } = fakeClient("thumbnail");
    const first = acquireHeroProfile(agent, client);
    await settle();
    first();
    await vi.advanceTimersByTimeAsync(HERO_RELEASE_GRACE_MS / 2);
    const second = acquireHeroProfile(agent, client);
    await vi.advanceTimersByTimeAsync(HERO_RELEASE_GRACE_MS);
    expect(releaseVideoProfile).not.toHaveBeenCalled();
    second();
    await vi.advanceTimersByTimeAsync(HERO_RELEASE_GRACE_MS);
    expect(releaseVideoProfile).toHaveBeenCalledTimes(1);
  });

  it("does not release or renew after a promotion the agent refused", async () => {
    const { client, setVideoProfile, releaseVideoProfile } = fakeClient("thumbnail");
    setVideoProfile.mockRejectedValueOnce(new Error("503"));
    const release = acquireHeroProfile(agent, client);
    await settle();
    await vi.advanceTimersByTimeAsync(HERO_RENEW_MS);
    release();
    await vi.advanceTimersByTimeAsync(HERO_RELEASE_GRACE_MS);
    expect(setVideoProfile).toHaveBeenCalledTimes(1);
    expect(releaseVideoProfile).not.toHaveBeenCalled();
  });

  it("retries a rate-limited promotion and renews the lease it then takes", async () => {
    const { client, getFullStatus, setVideoProfile } = fakeClient("thumbnail");
    getFullStatus.mockRejectedValueOnce(new AgentHttpError(429, "slow down"));
    acquireHeroProfile(agent, client);
    await settle();
    expect(setVideoProfile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HERO_RATE_LIMIT_BACKOFF_MS[0]);
    const lease = { holder: heroHolderId(), leaseS: HERO_LEASE_S };
    expect(getFullStatus).toHaveBeenCalledTimes(2);
    expect(setVideoProfile.mock.calls).toEqual([["hero", lease]]);
    await vi.advanceTimersByTimeAsync(HERO_RENEW_MS);
    expect(setVideoProfile.mock.calls).toEqual([["hero", lease], ["hero", lease]]);
  });

  it("retries a rate-limited lease request too, a bounded number of times", async () => {
    const { client, setVideoProfile } = fakeClient("thumbnail");
    setVideoProfile.mockRejectedValue(new AgentHttpError(429, "slow down"));
    acquireHeroProfile(agent, client);
    await settle();
    for (const delay of HERO_RATE_LIMIT_BACKOFF_MS) await vi.advanceTimersByTimeAsync(delay);
    await vi.advanceTimersByTimeAsync(HERO_RENEW_MS * 2);
    expect(setVideoProfile).toHaveBeenCalledTimes(HERO_RATE_LIMIT_BACKOFF_MS.length + 1);
  });

  it("stops retrying once the last surface lets go", async () => {
    const { client, getFullStatus, setVideoProfile, releaseVideoProfile } =
      fakeClient("thumbnail");
    getFullStatus.mockRejectedValue(new AgentHttpError(429, "slow down"));
    const release = acquireHeroProfile(agent, client);
    await settle();
    release();
    await vi.advanceTimersByTimeAsync(HERO_RELEASE_GRACE_MS + HERO_RENEW_MS);
    expect(getFullStatus).toHaveBeenCalledTimes(1);
    expect(setVideoProfile).not.toHaveBeenCalled();
    expect(releaseVideoProfile).not.toHaveBeenCalled();
  });

  describe("agent without leases", () => {
    it("demotes only a drone it promoted from thumbnail", async () => {
      const { client, setVideoProfile, releaseVideoProfile } = fakeClient("thumbnail", {
        leases: false,
      });
      const release = acquireHeroProfile(agent, client);
      await settle();
      await vi.advanceTimersByTimeAsync(HERO_RENEW_MS);
      expect(setVideoProfile).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(HERO_RELEASE_GRACE_MS);
      expect(setVideoProfile.mock.calls[1]).toEqual(["thumbnail"]);
      expect(releaseVideoProfile).not.toHaveBeenCalled();
    });

    it("never demotes a drone that was already on hero", async () => {
      const { client, setVideoProfile } = fakeClient("hero", { leases: false });
      const release = acquireHeroProfile(agent, client);
      await settle();
      release();
      await vi.advanceTimersByTimeAsync(HERO_RELEASE_GRACE_MS);
      expect(setVideoProfile).toHaveBeenCalledTimes(1);
    });
  });
});
