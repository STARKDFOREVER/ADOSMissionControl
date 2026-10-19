"use client";

/**
 * @module RadioTab
 * @description Command-tab home for a ground-station node's WFB-ng radio link
 * surface: the topology badge, live link stats and the TX power slider. The
 * panels read and write through the focused agent connection, so they render
 * only while that connection serves this node; otherwise one ground station's
 * radio would show (and retune) another's.
 *
 * A multi-adapter node also gets the per-adapter cards and the receive
 * diversity summary, read from `GET /api/v1/radio/adapters` when this node is
 * reachable and from the capability radio block (`RadioState.adapters`)
 * otherwise. Single-adapter nodes keep the plain view.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageIntro } from "@/components/hardware/PageIntro";
import { HintChip } from "@/components/hardware/HintChip";
import { RadioPanel } from "@/components/hardware/radio/RadioPanel";
import { VideoLinkPanel } from "@/components/hardware/VideoLinkPanel";
import { CloudModeLimitedNotice } from "@/components/command/shared/CloudModeLimitedNotice";
import { useNodeDirectAgent } from "@/components/command/settings/use-node-direct-agent";
import {
  diversitySummary,
  type RadioAdaptersResponse,
} from "@/lib/api/ground-station-api";
import {
  selectDeviceCapabilities,
  useAgentCapabilitiesStore,
} from "@/stores/agent-capabilities-store";
import { PhoneReceiversCard } from "./PhoneReceiversCard";
import { RadioAdaptersView } from "./RadioAdaptersView";
import { useGroundStationPoll } from "./use-gs-poll";

const ADAPTERS_POLL_MS = 2000;

export interface RadioTabProps {
  /** The node this tab is rendered for. */
  nodeDeviceId: string | null;
}

export function RadioTab({ nodeDeviceId }: RadioTabProps) {
  const t = useTranslations("hardware.radio");
  const direct = useNodeDirectAgent(nodeDeviceId);
  const agentUrl = direct?.agentUrl ?? null;
  const apiKey = direct?.apiKey ?? null;
  const radio = useAgentCapabilitiesStore((s) => selectDeviceCapabilities(s, nodeDeviceId)?.radio ?? null);
  // The REST read, tagged with the origin it came from so a late answer for
  // another node never renders here.
  const [rest, setRest] = useState<{ from: string; data: RadioAdaptersResponse } | null>(null);

  useGroundStationPoll(agentUrl, apiKey, ADAPTERS_POLL_MS, async (api) => {
    const data = await api.getRadioAdapters();
    setRest({ from: api.baseUrl, data });
  });

  const restOwned =
    rest !== null && agentUrl !== null && rest.from === agentUrl.replace(/\/+$/, "") ? rest.data : null;
  const adapters = restOwned?.adapters.length ? restOwned.adapters : (radio?.adapters ?? []);
  const summary = diversitySummary(adapters, restOwned?.diversity ?? null, radio?.lossPercent ?? null);

  return (
    <div className="flex flex-col gap-3">
      <PageIntro
        title={t("title")}
        description={t("description")}
        trailing={<HintChip>{t("topology.label")}</HintChip>}
      />
      {direct === null ? (
        <CloudModeLimitedNotice feature="radio" />
      ) : (
        <>
          {adapters.length > 1 ? <RadioAdaptersView adapters={adapters} summary={summary} /> : null}
          <RadioPanel />
          <VideoLinkPanel />
          <PhoneReceiversCard agentUrl={direct.agentUrl} apiKey={direct.apiKey} />
        </>
      )}
    </div>
  );
}
