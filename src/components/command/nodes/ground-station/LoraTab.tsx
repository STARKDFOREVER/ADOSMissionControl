"use client";

/**
 * @module ground-station/LoraTab
 * @description Ground-station LoRa lane with its multi-region duty governor
 * surfaced first: why transmit is blocked and how to fix it, the active
 * region and its legal source, one meter per declared rule, refusals,
 * beacons heard and the Meshtastic bridge. Polls status every second and
 * beacons every 5 s; the region table loads when the picker opens. A node
 * without the LoRa service reads "not fitted". Writes are locked while the
 * vehicle may be armed; in demo they are inert and say so.
 * @license GPL-3.0-only
 */

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { RadioTower } from "lucide-react";
import { PageIntro } from "@/components/hardware/PageIntro";
import { HintChip } from "@/components/hardware/HintChip";
import { CloudModeLimitedNotice } from "@/components/command/shared/CloudModeLimitedNotice";
import { useNodeDirectAgent } from "@/components/command/settings/use-node-direct-agent";
import { RegulatoryRegionPanel } from "@/components/command/system/RegulatoryRegionPanel";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useClockTick } from "@/lib/agent/freshness";
import { isDemoMode } from "@/lib/utils";
import {
  groundStationApiFromAgent,
  type ElrsModule,
  type LoraUpdate,
} from "@/lib/api/ground-station-api";
import { AgentArmedRefusal } from "@/lib/agent/agent-client/transport";
import { useClockStore } from "@/stores/clock-store";
import { useLoraStore } from "@/stores/ground-station/lora-store";
import {
  selectDeviceCapabilities,
  useAgentCapabilitiesStore,
} from "@/stores/agent-capabilities-store";
import { useGroundStationPoll } from "./use-gs-poll";
import { NotFitted } from "./lane-ui";
import { LoraLaneView } from "./lora/LoraLaneView";

const STATUS_POLL_MS = 1000;
const BEACONS_POLL_MS = 5000;
const NO_MODULES: readonly ElrsModule[] = [];

export interface LoraTabProps {
  /** The node this tab is rendered for. */
  nodeDeviceId: string | null;
}

export function LoraTab({ nodeDeviceId }: LoraTabProps) {
  const t = useTranslations("groundStationLanes");
  const direct = useNodeDirectAgent(nodeDeviceId);
  const agentUrl = direct?.agentUrl ?? null;
  const apiKey = direct?.apiKey ?? null;
  // In demo the client is null and the seeded slice carries a null origin.
  const target = groundStationApiFromAgent(agentUrl, apiKey)?.baseUrl ?? null;
  const owned = useLoraStore((s) => s.loraFor === target);
  const status = useLoraStore((s) => s.status);
  const regions = useLoraStore((s) => s.regions);
  const beacons = useLoraStore((s) => s.beacons);
  const error = useLoraStore((s) => s.error);
  const fetchedAt = useLoraStore((s) => s.fetchedAt);
  const applying = useLoraStore((s) => s.applying);
  const load = useLoraStore((s) => s.load);
  const loadBeacons = useLoraStore((s) => s.loadBeacons);
  const loadRegions = useLoraStore((s) => s.loadRegions);
  const apply = useLoraStore((s) => s.apply);
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  const { toast } = useToast();
  const [countryOpen, setCountryOpen] = useState(false);
  useClockTick();
  const now = useClockStore((s) => s.now);
  // The node's own capability slice: its country setting (the same reading
  // the operating-region panel shows) and its ELRS modules, for the
  // advisory chips under the region line.
  const radio = useAgentCapabilitiesStore((s) => selectDeviceCapabilities(s, nodeDeviceId)?.radio ?? null);
  const elrsModules = useAgentCapabilitiesStore(
    (s) => selectDeviceCapabilities(s, nodeDeviceId)?.crsf?.modules ?? NO_MODULES,
  );
  const countryRegion = radio?.pinnedRegion ?? radio?.regDomain ?? null;

  useGroundStationPoll(agentUrl, apiKey, STATUS_POLL_MS, load);
  useGroundStationPoll(agentUrl, apiKey, BEACONS_POLL_MS, loadBeacons);

  const onApply = async (body: LoraUpdate) => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) {
      if (isDemoMode()) toast(t("demoReadOnly"), "info");
      return;
    }
    try {
      const res = await apply(api, body);
      if (res) toast(t("lora.applied"), "success");
      else toast(useLoraStore.getState().error ?? t("lora.error", { message: "" }), "error");
    } catch (err) {
      if (err instanceof AgentArmedRefusal) toast(t("lora.armedRefused"), "warning");
      else throw err;
    }
  };

  const onOpenRegions = () => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (api) void loadRegions(api);
  };

  const shown = owned ? status : null;
  let body: ReactNode;
  if (direct === null) body = <CloudModeLimitedNotice feature="lora" />;
  else if (!shown) {
    body = (
      <p className="text-xs text-text-tertiary">
        {owned && error ? t("lora.error", { message: error }) : t("lora.loading")}
      </p>
    );
  } else if (!shown.present) {
    body = <NotFitted icon={RadioTower} title={t("lora.notFitted.title")} body={t("lora.notFitted.body")} />;
  } else {
    body = (
      <LoraLaneView
        status={shown}
        regions={regions}
        beacons={beacons}
        now={now}
        fetchedAt={fetchedAt}
        writeLock={isHardBlocked ? hardBlockMessage : null}
        applying={applying}
        onApply={(b) => void onApply(b)}
        onOpenRegions={onOpenRegions}
        onOpenCountrySetting={nodeDeviceId ? () => setCountryOpen(true) : undefined}
        countryRegion={countryRegion}
        elrsModules={elrsModules}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <PageIntro
        title={t("lora.title")}
        description={t("lora.description")}
        trailing={<HintChip>{t("lora.hint")}</HintChip>}
      />
      {body}
      {countryOpen ? (
        <Modal open onClose={() => setCountryOpen(false)} title={t("lora.countrySetting.title")} size="md">
          <RegulatoryRegionPanel nodeDeviceId={nodeDeviceId} />
        </Modal>
      ) : null}
    </div>
  );
}
