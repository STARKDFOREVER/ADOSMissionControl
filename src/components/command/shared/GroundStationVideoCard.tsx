"use client";

/**
 * @module GroundStationVideoCard
 * @description Downlink video for the GroundStationOverview. A ground
 * station decodes the drone's stream off the radio and republishes it on
 * the same WHEP endpoint a drone camera uses, so this reuses VideoFeedCard
 * verbatim and only adds a label + a live/idle status pill. The inner
 * card renders its own NO SIGNAL overlay when the agent isn't streaming. In
 * demo mode it plays the downlink's synthetic feed.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useVideoStore } from "@/stores/video-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useDroneManager } from "@/stores/drone-manager";
import { linkStateReach } from "@/components/hardware/radio/labels";
import { useDemoFeedPlaying } from "@/components/cockpit/CockpitDemoStream";
import { cn } from "@/lib/utils";
import { VideoFeedCard } from "./VideoFeedCard";

export function GroundStationVideoCard() {
  const t = useTranslations("groundStationOverview.video");
  const agentVideoState = useVideoStore((s) => s.agentVideoState);
  const isStreaming = useVideoStore((s) => s.isStreaming);
  // This overview is the selected node's; its demo feed is the relayed downlink.
  const nodeId = useDroneManager((s) => s.selectedDroneId) ?? undefined;
  const demoFeed = useDemoFeedPlaying(nodeId);
  const radio = useAgentCapabilitiesStore((s) => s.radio);
  // A ground station's video is the drone downlink it receives over the
  // radio, so a running video service only has something to relay while that
  // link is up. "Live" is claimed only from frames actually arriving.
  const radioUp = radio != null && linkStateReach(radio.state) === "up";

  const { label, tone } = isStreaming || demoFeed
    ? { label: t("live"), tone: "text-status-success" }
    : agentVideoState === "starting" || agentVideoState === "connecting"
      ? { label: t("connecting"), tone: "text-status-warning" }
      : agentVideoState === "running" && radioUp
        ? { label: t("ready"), tone: "text-text-secondary" }
        : { label: t("noSignal"), tone: "text-text-tertiary" };

  return (
    <div className="rounded-lg border border-border-default bg-bg-secondary p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wide text-text-tertiary">
          {t("title")}
        </h3>
        <span className={cn("text-[10px] uppercase tracking-wide", tone)}>
          {label}
        </span>
      </div>
      <VideoFeedCard droneId={nodeId} downlink />
    </div>
  );
}
