"use client";

/**
 * @module VisorOverview
 * @description Per-node overview for the `visor` profile: the agent's health,
 * the battery gauge, capture storage, the session clock, a rig summary and
 * the last capture session, then the host resources, services and logs. The
 * Sensors tab carries the full rig table; the capture extension's own tabs
 * carry recording and sessions.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { usePairingStore } from "@/stores/pairing-store";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { AgentStatusCard } from "../shared/AgentStatusCard";
import { SystemResourceGauges } from "../shared/SystemResourceGauges";
import { ServiceTable } from "../shared/ServiceTable";
import { LogViewer } from "../shared/LogViewer";
import { StaleBanner } from "../shared/StaleBanner";
import { NodeReachBlock } from "../shared/NodeReachBlock";
import { AgentDisconnectedPage } from "../AgentDisconnectedPage";
import { NodeBrandHeader } from "./NodeBrandHeader";
import { OverviewGrid, OverviewTile } from "./OverviewGrid";
import { useNodeSensors } from "../nodes/visor/use-node-sensors";
import {
  BatteryCard,
  ClockCard,
  LastSessionCard,
  RigCard,
  StorageCard,
} from "../nodes/visor/VisorReadingCards";

export interface VisorOverviewProps {
  name?: string;
  nodeDeviceId: string | null;
}

export function VisorOverview({ name, nodeDeviceId }: VisorOverviewProps) {
  const t = useTranslations("visor.overview");
  const connected = useAgentConnectionStore((s) => s.connected);
  const status = useAgentSystemStore((s) => s.status);
  const services = useAgentSystemStore((s) => s.services);
  const resources = useAgentSystemStore((s) => s.resources);
  const logs = useAgentSystemStore((s) => s.logs);
  const fetchServices = useAgentSystemStore((s) => s.fetchServices);
  const fetchResources = useAgentSystemStore((s) => s.fetchResources);
  const fetchLogs = useAgentSystemStore((s) => s.fetchLogs);
  const restartService = useAgentSystemStore((s) => s.restartService);
  const restartAll = useAgentSystemStore((s) => s.restartAll);
  const selectedNodeId = usePairingStore((s) => s.selectedPairedId);
  const { readings } = useNodeSensors(nodeDeviceId);

  useEffect(() => {
    if (connected) {
      fetchServices();
      fetchResources();
      fetchLogs();
    }
  }, [connected, fetchServices, fetchResources, fetchLogs]);

  if (!status) {
    if (!connected) {
      return (
        <>
          <div className="px-4 pt-4">
            <NodeReachBlock deviceId={deviceIdFromNodeId(selectedNodeId)} />
          </div>
          <AgentDisconnectedPage />
        </>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
        <p className="text-sm text-text-secondary">{t("waitingForStatus")}</p>
      </div>
    );
  }

  const title = name || status.board?.name || status.board?.model || t("fallbackTitle");
  return (
    <div className="space-y-4 p-4">
      <NodeBrandHeader profile="visor" title={title} />
      <StaleBanner />
      <OverviewGrid>
        <OverviewTile span="half" rowSpan={2}>
          <AgentStatusCard status={status} profile="visor" />
        </OverviewTile>
        <OverviewTile span="quarter">
          <BatteryCard battery={readings?.battery} />
        </OverviewTile>
        <OverviewTile span="quarter">
          <StorageCard storage={readings?.storage} />
        </OverviewTile>
        <OverviewTile span="quarter">
          <ClockCard clock={readings?.clock} />
        </OverviewTile>
        <OverviewTile span="quarter">
          <LastSessionCard sessions={readings?.sessions} />
        </OverviewTile>
        <OverviewTile span="full">
          <RigCard sensors={readings?.sensors} />
        </OverviewTile>
        <OverviewTile span="half">
          {resources && <SystemResourceGauges resources={resources} />}
        </OverviewTile>
        <OverviewTile span="half">
          <ServiceTable services={services} onRestart={restartService} onRestartAll={restartAll} />
        </OverviewTile>
        <OverviewTile span="full">
          <LogViewer logs={logs} onRefresh={fetchLogs} />
        </OverviewTile>
      </OverviewGrid>
    </div>
  );
}
