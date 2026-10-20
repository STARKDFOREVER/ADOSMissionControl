/**
 * @module use-shared-plan-link
 * @description Opens a plan shared by link (`#plan=<encoded>`) when the
 * planner loads.
 *
 * The shared plan always lands in the library as a plan of its own. When the
 * workspace holds no unsaved work it is opened at once; otherwise the
 * workspace is left alone and a toast offers to open the saved copy. A link
 * that does not decode says so. The fragment is cleared either way, so a
 * reload does not import the plan a second time.
 *
 * @license GPL-3.0-only
 */
"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";
import { useMissionStore } from "@/stores/mission-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { readPlanFromHash } from "@/lib/plan-share";
import {
  applyPlanToWorkspace,
  saveActivePlanFromWorkspace,
  workspaceHasUnsavedChanges,
} from "@/lib/plan-workspace";
import type { MissionFile } from "@/lib/mission-io";

/** What became of a shared plan: opened in the planner, or only saved to the library. */
export interface SharedPlanResult {
  planId: string;
  name: string;
  opened: boolean;
}

/**
 * Save a shared plan to the library, and open it unless the workspace holds
 * unsaved work. The sharer's vehicle assignment is not carried over: it names
 * an aircraft in someone else's fleet.
 */
export function openSharedPlan(file: MissionFile, fallbackName: string): SharedPlanResult {
  const name = file.metadata.name || fallbackName;
  const lib = usePlanLibraryStore.getState();
  const unsaved = workspaceHasUnsavedChanges();
  const before = { activePlanId: lib.activePlanId, isDirty: lib.isDirty, savedSnapshot: lib.savedSnapshot };
  const planId = lib.createPlan(name, file.waypoints, {}, {
    geofence: file.geofence,
    rally: file.rally,
    pois: file.pois,
    settings: file.settings,
  });
  if (unsaved) {
    // Creating a plan makes it active; the workspace still belongs to the plan
    // that was open, so put that back exactly as it was.
    lib.setActivePlan(before.activePlanId);
    lib.setDirty(before.isDirty);
    lib.setSavedSnapshot(before.savedSnapshot);
    return { planId, name, opened: false };
  }
  const plan = usePlanLibraryStore.getState().plans.find((p) => p.id === planId);
  if (plan) applyPlanToWorkspace(plan);
  return { planId, name, opened: true };
}

/**
 * Open a library plan from outside the library's own load path. Unsaved work
 * is saved to its plan (a new one when none is open) first, as the library
 * autosave would, so nothing is lost.
 */
export function openLibraryPlan(planId: string): { name: string; droneId?: string } | null {
  const plan = usePlanLibraryStore.getState().plans.find((p) => p.id === planId);
  if (!plan) return null;
  if (workspaceHasUnsavedChanges()) saveActivePlanFromWorkspace();
  applyPlanToWorkspace(plan);
  return { name: plan.name, droneId: plan.metadata.droneId };
}

/**
 * Handle a share link in the page URL once, after the persisted mission and
 * library have loaded (opening earlier would be overwritten by their restore).
 */
export function useSharedPlanLink(onPlanLoaded: (plan: { name: string; droneId?: string }) => void): void {
  const t = useTranslations("plannerIo");
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const link = readPlanFromHash(window.location.hash);
    if (link.status === "none") return;
    const clearFragment = () =>
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (link.status === "damaged") {
      clearFragment();
      toast(t("sharedPlanDamaged"), "error");
      return;
    }

    let done = false;
    const run = () => {
      if (done) return;
      if (!useMissionStore.persist.hasHydrated() || !usePlanLibraryStore.persist.hasHydrated()) return;
      done = true;
      clearFragment();
      const result = openSharedPlan(link.file, t("untitledPlan"));
      if (result.opened) {
        onPlanLoaded({ name: result.name });
        toast(t("sharedPlanOpened"), "success");
        return;
      }
      toast(t("sharedPlanSaved", { name: result.name }), "info", {
        action: {
          label: t("sharedPlanOpen"),
          onClick: () => {
            const opened = openLibraryPlan(result.planId);
            if (opened) onPlanLoaded(opened);
          },
        },
      });
    };
    const unsubscribe = [
      useMissionStore.persist.onFinishHydration(run),
      usePlanLibraryStore.persist.onFinishHydration(run),
    ];
    run();
    return () => {
      done = true;
      unsubscribe.forEach((off) => off());
    };
    // Runs once per page mount: the link is read from the URL the page opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
