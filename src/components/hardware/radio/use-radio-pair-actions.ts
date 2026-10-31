"use client";

/**
 * @module hardware/radio/use-radio-pair-actions
 * @description Pair-state poll and the bind, unpair and retry-local actions of the radio panel.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import type { useArmedOverrideConfirm } from "@/hooks/use-armed-override-confirm";
import {
  fetchPairStatus,
  setAutoPairOnRig,
  startLocalBind,
  unpairRig,
} from "@/lib/api/radio-pairing";
import type { LocalBindSession, PairStatusResponse } from "@/lib/api/ground-station/types";
import { PAIR_POLL_INTERVAL_MS } from "./constants";

type WithArmedOverride = ReturnType<typeof useArmedOverrideConfirm>["withArmedOverride"];

export function useRadioPairActions(
  agentUrl: string | null,
  apiKey: string | null,
  withArmedOverride: WithArmedOverride,
) {
  const t = useTranslations("hardware.radio");
  const { toast } = useToast();
  // null means the pair state is unknown: no answer yet, or the last check
  // failed. It is never read as "unpaired".
  const [pairStatus, setPairStatus] = useState<PairStatusResponse | null>(null);
  const [pairCheckNonce, setPairCheckNonce] = useState(0);
  const [bindSession, setBindSession] = useState<LocalBindSession | null>(null);
  const [bindBusy, setBindBusy] = useState(false);
  const [unpairBusy, setUnpairBusy] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);

  // Pair-state poller. Cheap (single GET against /api/wfb/pair); the
  // 2 Hz cadence is fine and matches the link-health poll above. Same
  // self-scheduling shape so a stalled request never stacks the next tick.
  useEffect(() => {
    // Gate on the GS CLIENT as well as the URL: in demo `agentUrl` is the
    // truthy non-HTTP string `mock://demo`, so a URL-only gate produced a
    // continuous stream of failed fetches to an unsupported scheme.
    if (!agentUrl || !groundStationApiFromAgent(agentUrl, apiKey)) return;
    const ctx = { baseUrl: agentUrl, apiKey };
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled || (typeof document !== "undefined" && document.hidden)) {
        if (!cancelled) timer = setTimeout(poll, PAIR_POLL_INTERVAL_MS);
        return;
      }
      try {
        const status = await fetchPairStatus(ctx);
        if (!cancelled) setPairStatus(status);
      } catch {
        // A failed check is "unknown", never "unpaired": the card offers a
        // retry and no bind until an answer arrives.
        if (!cancelled) setPairStatus(null);
      } finally {
        if (!cancelled) timer = setTimeout(poll, PAIR_POLL_INTERVAL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [agentUrl, apiKey, pairCheckNonce]);

  const handleRetryPairStatus = useCallback(() => {
    setPairCheckNonce((n) => n + 1);
  }, []);

  // Local-bind action. Synchronous: the agent runs the upstream
  // protocol to completion (≤60s) and returns the terminal session.
  const handleOpenLocalBind = useCallback(async () => {
    if (bindBusy) return;
    // Gate on the GS CLIENT as well as the URL: in demo `agentUrl` is the
    // truthy non-HTTP string `mock://demo`, so a URL-only gate produced a
    // continuous stream of failed fetches to an unsupported scheme.
    if (!agentUrl || !groundStationApiFromAgent(agentUrl, apiKey)) return;
    setBindBusy(true);
    setBindSession({
      session_id: "pending",
      role: "gs",
      state: "opening_tunnel",
      started_at: new Date().toISOString(),
      finished_at: null,
      error: null,
      fingerprint: null,
      peer_device_id: null,
      source: "operator",
    });
    toast(t("pairing.progressOpening"), "info");
    try {
      const session = await startLocalBind({ baseUrl: agentUrl, apiKey }, {});
      setBindSession(session);
      if (session.state === "paired") {
        toast(t("pairing.progressDone"), "success");
        // Force a fresh pair-status read so the UI flips immediately.
        try {
          const status = await fetchPairStatus({ baseUrl: agentUrl, apiKey });
          setPairStatus(status);
        } catch {
          setPairStatus(null);
        }
      } else {
        toast(
          t("pairing.errorAgentError", {
            message: session.error ?? session.state,
          }),
          "error",
        );
      }
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : String(exc);
      setBindSession((prev) =>
        prev ? { ...prev, state: "failed", error: msg } : null,
      );
      toast(t("pairing.errorAgentError", { message: msg }), "error");
    } finally {
      setBindBusy(false);
    }
  }, [agentUrl, apiKey, bindBusy, toast, t]);

  const handleUnpair = useCallback(async () => {
    if (unpairBusy) return;
    // Gate on the GS CLIENT as well as the URL: in demo `agentUrl` is the
    // truthy non-HTTP string `mock://demo`, so a URL-only gate produced a
    // continuous stream of failed fetches to an unsupported scheme.
    if (!agentUrl || !groundStationApiFromAgent(agentUrl, apiKey)) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(t("pairing.confirmUnpairBody"));
      if (!confirmed) return;
    }
    setUnpairBusy(true);
    try {
      await withArmedOverride((force) =>
        unpairRig({ baseUrl: agentUrl, apiKey }, { force }),
      );
      toast(t("pairing.statusUnpaired"), "info");
      try {
        const status = await fetchPairStatus({ baseUrl: agentUrl, apiKey });
        setPairStatus(status);
      } catch {
        setPairStatus(null);
      }
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : String(exc);
      toast(t("pairing.errorAgentError", { message: msg }), "error");
    } finally {
      setUnpairBusy(false);
    }
  }, [agentUrl, apiKey, unpairBusy, toast, t, withArmedOverride]);

  // Ask the rig's auto-pair supervisor to retry the local bind when the
  // heartbeat says the link has failed over to the cloud relay. The agent
  // answers whether anything will happen: a paired rig refuses a re-arm
  // (rearm_blocked), and only an applied request queues a retry the loop
  // consumes on its next tick.
  const handleRetryLocal = useCallback(async () => {
    if (retryBusy) return;
    // Gate on the GS CLIENT as well as the URL: in demo `agentUrl` is the
    // truthy non-HTTP string `mock://demo`, so a URL-only gate produced a
    // continuous stream of failed fetches to an unsupported scheme.
    if (!agentUrl || !groundStationApiFromAgent(agentUrl, apiKey)) return;
    setRetryBusy(true);
    try {
      const res = await setAutoPairOnRig({ baseUrl: agentUrl, apiKey }, true);
      if (res.rearm_blocked) {
        toast(t("pairing.failover.retryBlockedPaired"), "warning");
      } else if (!res.applied) {
        toast(t("pairing.failover.retryNotApplied"), "error");
      } else {
        toast(t("pairing.failover.retrySuccess"), "success");
      }
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : String(exc);
      toast(t("pairing.errorAgentError", { message: msg }), "error");
    } finally {
      setRetryBusy(false);
    }
  }, [agentUrl, apiKey, retryBusy, toast, t]);

  return {
    pairStatus,
    bindSession,
    bindBusy,
    unpairBusy,
    retryBusy,
    handleRetryPairStatus,
    handleOpenLocalBind,
    handleUnpair,
    handleRetryLocal,
  };
}
