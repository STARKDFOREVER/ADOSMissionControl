"use client";

import { useTranslations } from "next-intl";
import {
  Expand,
  Pause,
  Pin,
  PinOff,
  Play,
  RefreshCw,
} from "lucide-react";
import type { CommandAgentSummary } from "@/hooks/use-command-agent-fleet";

// The 4-button action cluster (pin, pause, retry, open) or a compact
// pin+open cluster for the profiles that have no video feed.
export function TileActions({
  agent,
  pinned,
  paused,
  showVideoControls,
  onOpen,
  onTogglePin,
  onTogglePause,
  onRetry,
}: {
  agent: CommandAgentSummary;
  pinned: boolean;
  paused: boolean;
  showVideoControls: boolean;
  onOpen: (deviceId: string) => void;
  onTogglePin: (deviceId: string) => void;
  onTogglePause: (deviceId: string) => void;
  onRetry: () => void;
}) {
  const t = useTranslations("commandFleet");
  return (
    <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(agent.identity.deviceId);
        }}
        className="rounded bg-scrim/55 p-1 text-text-secondary hover:text-text-primary"
        title={pinned ? t("unpin") : t("pin")}
      >
        {pinned ? <PinOff size={13} /> : <Pin size={13} />}
      </button>
      {showVideoControls && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePause(agent.identity.deviceId);
            }}
            className="rounded bg-scrim/55 p-1 text-text-secondary hover:text-text-primary"
            title={paused ? t("resume") : t("pause")}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            className="rounded bg-scrim/55 p-1 text-text-secondary hover:text-text-primary"
            title={t("retry")}
          >
            <RefreshCw size={13} />
          </button>
        </>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(agent.identity.deviceId);
        }}
        className="rounded bg-accent-primary p-1 text-bg-primary hover:opacity-90"
        title={t("open")}
      >
        <Expand size={13} />
      </button>
    </div>
  );
}
