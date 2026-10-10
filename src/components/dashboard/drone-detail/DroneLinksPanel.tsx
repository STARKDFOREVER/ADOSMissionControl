"use client";

/**
 * @module DroneLinksPanel
 * @description The links a multi-link drone holds: each link's type, label,
 * how long since it last delivered a byte, and which one carries commands.
 * Removing a link detaches it through the drone manager; removing the last
 * one disconnects the drone.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Cable, X } from "lucide-react";
import { useDroneManager } from "@/stores/drone-manager";
import { useClockTick } from "@/lib/agent/freshness";

/** Seconds since `at`, or null when the link has never delivered a byte. */
function ageSeconds(at: number): number | null {
  return at > 0 ? Math.max(0, Math.floor((Date.now() - at) / 1000)) : null;
}

export function DroneLinksPanel({ droneId }: { droneId: string }) {
  const t = useTranslations("droneLinks");
  // linkInfo is a live getter; the 1 Hz tick re-reads it and ages lastByteAt.
  useClockTick();
  const drone = useDroneManager((s) => s.drones.get(droneId));
  const detachLink = useDroneManager((s) => s.detachLinkFromDrone);
  const [removing, setRemoving] = useState<string | null>(null);

  // The Overview hosts this panel for drones still being set up, whose
  // protocol is not attached yet; its sibling FC readers guard the same way.
  const links = drone?.protocol?.linkInfo;
  if (!links || links.length === 0) return null;

  return (
    <section
      aria-label={t("title")}
      className="border border-border-default bg-bg-secondary p-3"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
        <Cable className="h-3 w-3" aria-hidden="true" />
        {t("title")}
      </div>
      <ul className="space-y-1">
        {links.map((link) => {
          const age = ageSeconds(link.lastByteAt);
          return (
            <li key={link.id} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-text-tertiary">{link.type}</span>
              <span className="flex-1 truncate text-text-primary">{link.label}</span>
              {link.isPrimary && (
                <span className="border border-accent-primary/40 px-1 text-[10px] uppercase text-accent-primary">
                  {t("primary")}
                </span>
              )}
              <span className="font-mono text-text-tertiary">
                {age === null ? t("noData") : t("age", { seconds: age })}
              </span>
              <button
                type="button"
                disabled={removing === link.id}
                onClick={() => {
                  setRemoving(link.id);
                  void detachLink(droneId, link.id).finally(() => setRemoving(null));
                }}
                aria-label={t("remove", { label: link.label })}
                className="text-text-tertiary hover:text-text-primary disabled:opacity-50 focus-ring"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
