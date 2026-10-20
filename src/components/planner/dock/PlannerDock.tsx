/**
 * @module PlannerDock
 * @description Bottom dock of the planner map region. Collapsed it is a 32 px
 * strip with the mission summary and the review tabs; expanded, a 200 px
 * drawer above the strip shows the open tab (altitude, terrain, issues,
 * energy, site, checklist). Open state and tab live in the planner store, so
 * the T / I shortcuts and the planner bar's issue chip drive the same dock.
 *
 * The drawer slides only when a tab click opened or closed it; a keyboard
 * toggle snaps it. While a click-close animates, the last tab body stays
 * rendered so the drawer does not empty before it leaves.
 * @license GPL-3.0-only
 */
"use client";

import { useId, useState, type TransitionEvent } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { Planner } from "@/app/plan/use-planner";
import { usePlannerValidation } from "@/hooks/use-planner-validation";
import { MAP_OVERLAY_Z } from "@/lib/map-overlay-z";
import { cn } from "@/lib/utils";
import { DOCK_TABS, usePlannerStore, type DockTab } from "@/stores/planner-store";
import { usePreflightChecklistStore } from "@/stores/preflight-checklist-store";
import { PREFLIGHT_ITEM_IDS, countCheckedPreflightItems } from "@/components/planner/preflight-items";
import { DockStats } from "./DockStats";
import { DockTabContent } from "./DockTabContent";

export const DOCK_STRIP_HEIGHT = 32;
export const DOCK_DRAWER_HEIGHT = 200;

interface PlannerDockProps {
  /** The planner; the dock reads only these members. */
  p: Pick<Planner, "waypoints" | "selectedWaypointId" | "setSelectedWaypoint">;
}

export function PlannerDock({ p }: PlannerDockProps) {
  const t = useTranslations("planner.dock");
  const dockOpen = usePlannerStore((s) => s.dockOpen);
  const dockTab = usePlannerStore((s) => s.dockTab);
  const setDock = usePlannerStore((s) => s.setDock);
  const checked = usePreflightChecklistStore((s) => s.checked);
  const panelId = useId();

  // True from a tab click that opens or closes the drawer until its slide ends.
  const [animate, setAnimate] = useState(false);

  const validation = usePlannerValidation(p.waypoints);
  const issues = { errors: validation?.errors.length ?? 0, warnings: validation?.warnings.length ?? 0 };
  const checkedCount = countCheckedPreflightItems(checked);

  const onTabClick = (tab: DockTab) => {
    if (!dockOpen || dockTab === tab) setAnimate(true);
    setDock(tab);
  };

  const onDrawerTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) setAnimate(false);
  };

  const showBody = dockOpen || animate;

  return (
    <div
      role="region"
      aria-label={t("ariaLabel")}
      className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col"
      style={{ zIndex: MAP_OVERLAY_Z.panel }}
    >
      {/* Drawer: clipped so it slides out of view behind the strip. */}
      <div className="overflow-hidden" style={{ height: DOCK_DRAWER_HEIGHT }}>
        <div
          id={panelId}
          role="tabpanel"
          aria-label={t(`tab.${dockTab}`)}
          inert={!dockOpen}
          onTransitionEnd={onDrawerTransitionEnd}
          className={cn(
            "h-full border-t border-border-default bg-bg-primary/95 backdrop-blur-md",
            // Tailwind 4 translate utilities set the `translate` property, so
            // that is what transitions; reduced motion keeps only the fade.
            dockOpen ? "pointer-events-auto translate-y-0 opacity-100" : "translate-y-full opacity-0",
            "motion-reduce:translate-y-0",
            animate && "transition-[translate,opacity] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
          )}
        >
          {showBody && (
            <DockTabContent
              tab={dockTab}
              waypoints={p.waypoints}
              selectedWaypointId={p.selectedWaypointId}
              onSelectWaypoint={p.setSelectedWaypoint}
            />
          )}
        </div>
      </div>

      {/* Strip */}
      <div
        className="pointer-events-auto flex items-center gap-3 border-t border-border-default bg-bg-primary/95 px-3 backdrop-blur-md"
        style={{ height: DOCK_STRIP_HEIGHT }}
      >
        <div className="min-w-0 flex-1">
          <DockStats />
        </div>
        <div role="tablist" aria-label={t("tabsLabel")} className="flex shrink-0 items-center gap-0.5">
          {DOCK_TABS.map((tab) => {
            const selected = dockOpen && dockTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                onClick={() => onTabClick(tab)}
                className={cn(
                  "flex h-6 items-center gap-1.5 rounded px-2 text-xs transition-colors cursor-pointer focus-ring",
                  selected
                    ? "bg-bg-tertiary text-accent-primary"
                    : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary",
                )}
              >
                {t(`tab.${tab}`)}
                {tab === "issues" && issues.errors + issues.warnings > 0 && (
                  <span
                    title={t("issueBadge", issues)}
                    className={cn(
                      "font-mono text-[11px] tabular-nums",
                      issues.errors > 0 ? "text-status-error" : "text-status-warning",
                    )}
                  >
                    {issues.errors + issues.warnings}
                  </span>
                )}
                {tab === "checklist" && (
                  <span
                    title={t("checklistBadge", { checked: checkedCount, total: PREFLIGHT_ITEM_IDS.length })}
                    className="font-mono text-[11px] tabular-nums text-text-tertiary"
                  >
                    {checkedCount}/{PREFLIGHT_ITEM_IDS.length}
                  </span>
                )}
              </button>
            );
          })}
          {dockOpen && (
            <button
              type="button"
              onClick={() => onTabClick(dockTab)}
              aria-label={t("collapse")}
              title={t("collapse")}
              className="ml-1 flex h-6 w-6 items-center justify-center rounded text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary cursor-pointer focus-ring"
            >
              <ChevronDown size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
