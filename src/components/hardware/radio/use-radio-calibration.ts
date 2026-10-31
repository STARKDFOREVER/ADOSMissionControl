"use client";

/**
 * @module hardware/radio/use-radio-calibration
 * @description Sweep, measure and last-good callbacks the link calibration wizard runs against.
 * @license GPL-3.0-only
 */

import { useCallback, useMemo, type RefObject } from "react";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import type { CalMeasurement, CalTrio } from "@/lib/api/ground-station/calibration";
import type { pickReceiverFromCloud } from "./cloud-radio";

export function useRadioCalibration(
  agentUrl: string | null,
  apiKey: string | null,
  receiverRef: RefObject<ReturnType<typeof pickReceiverFromCloud>>,
  mcsIndex: number | null,
  fecK: number | null,
  fecN: number | null,
) {
  // Calibration callbacks are memoized: the wizard holds a run across parent
  // renders, and the poll ticks above re-render this panel twice a second.
  // Sweep the connected (transmit) agent's trio; setFec + setMcs are applied
  // in sequence (the agent persists each) and the wizard's settle window
  // covers the respawns.
  const calibrationSweep = useCallback(
    async (trio: CalTrio): Promise<void> => {
      const api = groundStationApiFromAgent(agentUrl, apiKey);
      if (!api) throw new Error("agent not connected");
      await api.setFec(trio.fecK, trio.fecN);
      await api.setMcs(trio.mcs);
    },
    [agentUrl, apiKey],
  );
  const calibrationMeasure = useCallback((): CalMeasurement => {
    const { radio: r, updatedAt } = receiverRef.current;
    return {
      // The row's own write stamp: the engine only scores snapshots written
      // after the trio under test was applied.
      sampledAtMs: r ? updatedAt : null,
      lossPercent: r?.lossPercent ?? null,
      // The receiver's unrecoverable-block counter is the decode-side fail
      // signal: scored from confirmed reception, never the transmitter's
      // own tx_bytes (an advancing TX counter is not proof of a live link).
      fecFailed: r?.fecLost ?? null,
      validRxPacketsPerS: r?.validRxPacketsPerS ?? null,
      bitrateKbps: r?.bitrateKbps ?? null,
      rssiDbm: r?.rssiDbm ?? null,
    };
  }, [receiverRef]);
  const calibrationLastGood = useMemo<CalTrio | null>(
    () =>
      mcsIndex != null && fecK != null && fecN != null
        ? { mcs: mcsIndex, fecK, fecN }
        : null,
    [mcsIndex, fecK, fecN],
  );


  return { calibrationSweep, calibrationMeasure, calibrationLastGood };
}
