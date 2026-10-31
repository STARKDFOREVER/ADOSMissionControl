"use client";

import { useEffect, useRef } from "react";
import type { TelemetryDeckMetricId } from "@/stores/settings-store";
import { useToast } from "@/components/ui/toast";
import type { DeckSeverityContext } from "./deck-types";
import { METRIC_LABELS_BY_ID } from "./deck-constants";
import { DECK_METRIC_IDS, type DeckMetricReadings } from "./deck-metric-table";
import { getSeverity, trackSeverity, type SeverityTrack } from "./deck-utils";

/**
 * Toast on severity transitions that hold for the dwell window, so a value
 * flickering across a band edge (fix type, attitude, climb) is not a toast
 * storm.
 *
 * Every metric is judged, not only the ones on the visible deck page: a
 * critical battery on a hidden page still has to reach the operator.
 */
export function useDeckSeverityAlerts(readings: DeckMetricReadings, context: DeckSeverityContext): void {
  const tracks = useRef<Partial<Record<TelemetryDeckMetricId, SeverityTrack>>>({});
  const { toast } = useToast();

  useEffect(() => {
    const now = Date.now();
    for (const metricId of DECK_METRIC_IDS) {
      const current = getSeverity(metricId, readings.raw[metricId], context);
      const { track, announce } = trackSeverity(tracks.current[metricId], current, now);
      tracks.current[metricId] = track;
      if (announce) {
        const status = announce === "critical" ? "error" : "warning";
        toast(`${METRIC_LABELS_BY_ID[metricId]} ${announce}: ${readings.display[metricId]}`, status);
      }
    }
  }, [readings, context, toast]);
}
