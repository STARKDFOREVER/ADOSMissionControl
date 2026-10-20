/**
 * @module use-pattern-apply
 * @description Applies the generated pattern to the plan, asking first when
 * that would replace waypoints the plan already has.
 * @license GPL-3.0-only
 */

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { usePatternStore } from "@/stores/pattern-store";
import { patternToMission } from "@/lib/patterns/pattern-to-mission";
import type { Waypoint } from "@/lib/types";
import type { PlannerToast } from "./use-planner-state";

interface PatternApplyDeps {
  activePlanId: string | null;
  waypointCount: number;
  setWaypoints: (wps: Waypoint[]) => void;
  setShowPatternApplyConfirm?: (show: boolean) => void;
  toast: PlannerToast;
}

export function usePatternApply({
  activePlanId, waypointCount, setWaypoints, setShowPatternApplyConfirm, toast,
}: PatternApplyDeps) {
  const t = useTranslations("planner.toast");

  // The actual replace-every-waypoint apply. Kept separate from the gate so it
  // can be invoked directly (empty mission) or after the destructive-apply
  // confirm (mission already has waypoints).
  const doPatternApply = useCallback(() => {
    const patternStore = usePatternStore.getState();
    const result = patternStore.patternResult;
    if (!result || result.waypoints.length === 0) { toast(t("noPattern"), "info"); return; }
    if (!activePlanId) { toast(t("openPlanFirst"), "info"); return; }

    // One converter shared with the mission templates: actions fold onto the
    // navigation waypoint they follow, every waypoint carries the frame the
    // generator's altitudes are measured in (above home), and TAKEOFF / RTL
    // bookend the mission. The terrain sync samples the new waypoints.
    const newWaypoints = patternToMission(result.waypoints);
    if (newWaypoints.length === 0) { toast(t("patternEmpty"), "warning"); return; }
    setWaypoints(newWaypoints);
    patternStore.clear();
    const { totalDistance, estimatedTime } = result.stats;
    const distance = totalDistance >= 1000
      ? t("distanceKm", { value: (totalDistance / 1000).toFixed(1) })
      : t("distanceM", { value: Math.round(totalDistance) });
    const time = estimatedTime >= 60
      ? t("timeMin", { value: Math.round(estimatedTime / 60) })
      : t("timeSec", { value: Math.round(estimatedTime) });
    toast(t("patternApplied", { count: newWaypoints.length, distance, time }), "success");
  }, [activePlanId, setWaypoints, toast, t]);

  const handlePatternApply = useCallback(() => {
    // Applying a pattern REPLACES every waypoint. If the mission already has
    // waypoints, open the confirm and stop here so nothing is discarded without
    // consent; an empty mission applies straight away with no prompt.
    const result = usePatternStore.getState().patternResult;
    if (!result || result.waypoints.length === 0) { toast(t("noPattern"), "info"); return; }
    if (!activePlanId) { toast(t("openPlanFirst"), "info"); return; }
    if (waypointCount > 0) { setShowPatternApplyConfirm?.(true); return; }
    doPatternApply();
  }, [waypointCount, activePlanId, doPatternApply, setShowPatternApplyConfirm, toast, t]);

  const applyPatternConfirmed = useCallback(() => {
    setShowPatternApplyConfirm?.(false);
    doPatternApply();
  }, [doPatternApply, setShowPatternApplyConfirm]);

  return { handlePatternApply, applyPatternConfirmed };
}
