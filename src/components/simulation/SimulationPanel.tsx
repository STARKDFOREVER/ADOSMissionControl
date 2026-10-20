/**
 * @module SimulationPanel
 * @description Unified right-side panel for simulation mode. Composes the
 * stats grid, waypoint list, and controls sub-components. Owns store
 * subscriptions, derived data, collapsible state, and action handlers.
 * @license GPL-3.0-only
 */

"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { Waypoint } from "@/lib/types";
import { currentExportOptions } from "@/lib/mission-io";
import { exportWaypointsFormat } from "@/lib/mission-io-formats";
import { applyTransit } from "@/lib/mission/transit";
import { useSimulationStore } from "@/stores/simulation-store";
import { useInterpolatedPosition } from "@/hooks/use-interpolated-position";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useSimHistoryStore } from "@/stores/simulation-history-store";
import { useToast } from "@/components/ui/toast";
import { SimulationStatsGrid } from "./SimulationStatsGrid";
import { SimulationWaypointList } from "./SimulationWaypointList";
import { SimulationControls } from "./SimulationControls";

// Keyboard shortcuts reference
const SHORTCUTS = [
  { key: "Space", action: "Play / Pause" },
  { key: "Esc", action: "Stop" },
  { key: "R", action: "Reset playback" },
  { key: "→", action: "Step forward 1s" },
  { key: "←", action: "Step back 1s" },
  { key: "T", action: "Top-down camera" },
  { key: "F", action: "Follow camera" },
  { key: "O", action: "Orbit camera" },
  { key: "X", action: "Free camera" },
  { key: "1-9", action: "Seek to 10-90%" },
  { key: "]", action: "Increase speed" },
  { key: "[", action: "Decrease speed" },
  { key: "Home", action: "Rewind to start" },
  { key: "End", action: "Skip to end" },
  { key: "L", action: "Toggle library" },
];

interface SimulationPanelProps {
  waypoints: Waypoint[];
  onClose: () => void;
}

export function SimulationPanel({
  waypoints,
  onClose,
}: SimulationPanelProps) {
  const router = useRouter();
  const t = useTranslations("simulate");
  const { toast } = useToast();

  // Simulation store
  const totalDuration = useSimulationStore((s) => s.totalDuration);
  const playbackState = useSimulationStore((s) => s.playbackState);
  const seek = useSimulationStore((s) => s.seek);

  // Other stores
  const activePlanId = usePlanLibraryStore((s) => s.activePlanId);
  const plans = usePlanLibraryStore((s) => s.plans);
  const missionWaypoints = useMissionStore((s) => s.waypoints);
  const transitAltM = useMissionStore((s) => s.transitAltM);
  const plannedHome = useMissionStore((s) => s.plannedHome);
  const historyEntries = useSimHistoryStore((s) => s.entries);
  const clearHistory = useSimHistoryStore((s) => s.clearHistory);

  // Interpolated position
  const { pos, flightPlan, elapsed } = useInterpolatedPosition();

  // Local UI state
  const [terrainExpanded, setTerrainExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [shortcutsExpanded, setShortcutsExpanded] = useState(false);

  // Derived data
  const activePlan = plans.find((p) => p.id === activePlanId);
  const progressPct = totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0;

  // When each waypoint is first reached, for its ETA and for seeking to it.
  const arrivalTimes = useMemo(() => {
    const times: Array<number | undefined> = new Array(waypoints.length).fill(undefined);
    let start = 0;
    for (const seg of flightPlan.segments) {
      if (times[seg.toIndex] === undefined && seg.toIndex !== seg.fromIndex) times[seg.toIndex] = seg.cumulativeDuration;
      if (seg.kind === "climb" && times[seg.fromIndex] === undefined) times[seg.fromIndex] = start;
      start = seg.cumulativeDuration;
    }
    return times;
  }, [flightPlan.segments, waypoints.length]);

  // Handlers

  const handleExport = () => {
    if (missionWaypoints.length === 0) return;
    const name = activePlan?.name || "simulation";
    // The file carries the transit legs the vehicle flies.
    const flown = applyTransit(missionWaypoints, transitAltM, {
      homeGroundElevation: plannedHome?.groundAmsl,
      defaultFrame: usePlannerStore.getState().defaultFrame,
    });
    exportWaypointsFormat(flown, name, currentExportOptions());
    toast("Exported .waypoints", "success");
  };

  const handleSeekToWaypoint = (wpIndex: number) => {
    const arrival = wpIndex === 0 ? 0 : arrivalTimes[wpIndex];
    if (arrival !== undefined) seek(arrival);
  };

  return (
    <div className="w-[320px] shrink-0 flex flex-col border-l border-border-default bg-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-display font-semibold text-text-primary">{t("title")}</h2>
          {activePlan && (
            <span className="text-[10px] font-mono text-text-tertiary truncate">
              {activePlan.name}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-text-tertiary hover:text-text-primary cursor-pointer shrink-0"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <SimulationStatsGrid
          waypoints={waypoints}
          flightPlan={flightPlan}
          totalDuration={totalDuration}
          speed={pos.speed}
          heading={pos.heading}
          progressPct={progressPct}
          terrainExpanded={terrainExpanded}
          onToggleTerrain={() => setTerrainExpanded(!terrainExpanded)}
        />

        <SimulationWaypointList
          waypoints={waypoints}
          pos={pos}
          elapsed={elapsed}
          arrivalTimes={arrivalTimes}
          playbackState={playbackState}
          onSeekToWaypoint={handleSeekToWaypoint}
        />

        <SimulationControls
          onEditInPlanner={() => router.push("/plan")}
          onExport={handleExport}
          exportDisabled={missionWaypoints.length === 0}
          historyEntries={historyEntries}
          historyExpanded={historyExpanded}
          onToggleHistory={() => setHistoryExpanded(!historyExpanded)}
          onClearHistory={clearHistory}
          shortcutsExpanded={shortcutsExpanded}
          onToggleShortcuts={() => setShortcutsExpanded(!shortcutsExpanded)}
          shortcuts={SHORTCUTS}
        />
      </div>
    </div>
  );
}
