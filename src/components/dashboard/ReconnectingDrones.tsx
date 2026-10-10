"use client";

/**
 * @module ReconnectingDrones
 * @description Fleet-list rows for drones being re-dialled after a link loss.
 * A direct FC's fleet row leaves with its session, so without these the only
 * sign of a running cycle was the toast. Each row names the drone, the
 * attempt count, and offers to stop the cycle.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { useReconnectStore } from "@/stores/reconnect-store";

export function ReconnectingDrones() {
  const t = useTranslations("fleet.reconnecting");
  const entries = useReconnectStore((s) => s.entries);
  const cancel = useReconnectStore((s) => s.cancel);
  if (entries.size === 0) return null;

  return (
    <ul aria-label={t("title")} className="space-y-1 px-3 pt-2">
      {[...entries.values()].map((entry) => (
        <li
          key={entry.droneId}
          className="flex items-center gap-2 border border-status-warning/40 bg-status-warning/5 px-2 py-1.5 text-xs"
        >
          <RefreshCw size={12} className="shrink-0 animate-spin text-status-warning" aria-hidden="true" />
          <span className="flex-1 truncate text-text-primary">
            {t("label", { name: entry.droneName, attempts: entry.attempts })}
          </span>
          <button
            type="button"
            onClick={() => cancel(entry.droneId)}
            className="font-medium text-accent-primary hover:underline focus-ring"
          >
            {t("stop")}
          </button>
        </li>
      ))}
    </ul>
  );
}
