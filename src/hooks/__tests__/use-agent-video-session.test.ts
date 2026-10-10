/**
 * A fleet tile's WHEP session presents the node's pairing key on the offer and
 * on the session DELETE: a paired node's front answers an unauthenticated
 * WHEP request with 401.
 *
 * @license GPL-3.0-only
 */

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentVideoSession } from "@/hooks/use-agent-video-session";

const WHEP = "http://192.168.1.50:8080/whep";

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  iceGatheringState: RTCIceGathererState = "complete";
  localDescription: { sdp: string } | null = null;
  ontrack: ((event: { streams: unknown[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  addTransceiver() {}
  async createOffer() {
    return { type: "offer", sdp: "offer" };
  }
  async setLocalDescription(desc: { sdp: string }) {
    this.localDescription = desc;
  }
  async setRemoteDescription() {
    this.ontrack?.({ streams: [{ getTracks: () => [] }] });
  }
  getReceivers() {
    return [];
  }
  async getStats() {
    return new Map();
  }
  close() {}
}

const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === "DELETE") return new Response(null, { status: 200 });
  return new Response("answer", {
    status: 201,
    headers: { Location: "/whep/session-1?camera=main" },
  });
});

/** jsdom's <video> refuses a non-MediaStream `srcObject`; the hook only assigns it. */
const fakeVideo = () => ({ srcObject: null }) as unknown as HTMLVideoElement;

const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
const deletes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");
const keyOf = (init: RequestInit | undefined) => new Headers(init?.headers).get("X-ADOS-Key");

describe("useAgentVideoSession", () => {
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends the pairing key on the offer and on the session DELETE", async () => {
    const videoEl = fakeVideo();
    const { result, unmount } = renderHook(() =>
      useAgentVideoSession({ whepUrl: WHEP, apiKey: "k-1", enabled: true, videoEl, retryKey: 0 }),
    );
    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(posts()).toHaveLength(1);
    expect(posts()[0][0]).toBe(WHEP);
    expect(keyOf(posts()[0][1])).toBe("k-1");
    expect(new Headers(posts()[0][1]?.headers).get("Content-Type")).toBe("application/sdp");

    unmount();
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0][0]).toBe("http://192.168.1.50:8080/whep/session-1?camera=main");
    expect(keyOf(deletes()[0][1])).toBe("k-1");
  });

  it("sends no key header when it has none", async () => {
    const videoEl = fakeVideo();
    const { result } = renderHook(() =>
      useAgentVideoSession({ whepUrl: WHEP, apiKey: null, enabled: true, videoEl, retryKey: 0 }),
    );
    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(keyOf(posts()[0][1])).toBeNull();
  });

  it("reports a refused offer as WHEP <status>", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("", { status: 401 }));
    const videoEl = fakeVideo();
    const { result } = renderHook(() =>
      useAgentVideoSession({ whepUrl: WHEP, apiKey: null, enabled: true, videoEl, retryKey: 0 }),
    );
    await waitFor(() => expect(result.current.state).toBe("failed"));
    expect(result.current.error).toBe("WHEP 401");
    expect(deletes()).toHaveLength(0);
  });
});
