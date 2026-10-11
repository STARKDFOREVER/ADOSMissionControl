/**
 * @license GPL-3.0-only
 *
 * In demo mode the Overview video card plays the node's synthetic feed, the
 * same one the cockpit paints, instead of dialling transports that cannot
 * exist; the transport menu still switches it, and Off turns it off.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const demo = vi.hoisted(() => ({ on: true }));
vi.mock("@/hooks/use-demo-mode", () => ({ useDemoMode: () => demo.on }));
vi.mock("@/hooks/use-video-latency-poll", () => ({ useVideoLatencyPoll: () => {} }));
vi.mock("@/hooks/use-drone-clock-offset", () => ({ useDroneClockOffset: () => {} }));

import messages from "../../../../../locales/en.json";
import { VideoFeedCard } from "../VideoFeedCard";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useVideoStreamsStore } from "@/stores/video-streams-store";

const DRONE = "node:d1";

function renderCard(downlink = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VideoFeedCard droneId={DRONE} downlink={downlink} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  demo.on = true;
  useVideoStreamsStore.getState().clear();
  useSettingsStore.setState({ videoTransportMode: "auto" });
  useAgentCapabilitiesStore.setState({
    cameras: [],
    videoStreams: [
      { id: "main", role: "eo", codec: "h264", whepUrl: "http://192.168.4.1:8889/main/whep" },
      { id: "ir", role: "ir", codec: "h264", whepUrl: "http://192.168.4.1:8889/ir/whep" },
    ],
  });
});
afterEach(cleanup);

describe("VideoFeedCard demo feed", () => {
  it("plays the node's demo feed under the transport menu", () => {
    const { container } = renderCard();
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(screen.queryByText("NO SIGNAL")).toBeNull();
    expect(screen.getByLabelText("Video transport switcher").textContent).toMatch(/^AUTO/);
  });

  it("goes dark when video is switched Off", () => {
    useSettingsStore.setState({ videoTransportMode: "off" });
    const { container } = renderCard();
    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.getByText("NO SIGNAL")).toBeTruthy();
  });

  it("plays a ground station's relayed downlink though it has no camera of its own", () => {
    useAgentCapabilitiesStore.setState({ cameras: [], videoStreams: [] });
    const { container } = renderCard(true);
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(useVideoStreamsStore.getState().streamsForDrone(DRONE).map((s) => s.id)).toEqual(["downlink"]);
  });

  it("never paints a demo feed outside demo mode", () => {
    demo.on = false;
    const { container } = renderCard();
    expect(container.querySelector("canvas")).toBeNull();
    expect(useVideoStreamsStore.getState().streamsForDrone(DRONE)).toEqual([]);
  });
});
