/**
 * @module DockTabContent
 * @description Body of the planner dock drawer for one tab: altitude profile,
 * terrain profile, validation issues, energy estimate, site conditions (sun
 * and weather) and the pre-flight checklist.
 * @license GPL-3.0-only
 */
"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Waypoint } from "@/lib/types";
import type { DockTab } from "@/stores/planner-store";
import { usePlannerStore } from "@/stores/planner-store";
import { AltitudeProfile } from "@/components/planner/AltitudeProfile";
import { TerrainProfileChart } from "@/components/planner/TerrainProfileChart";
import { ValidationPanel } from "@/components/planner/ValidationPanel";
import { EnergyCard } from "@/components/planner/EnergyCard";
import { SunTimesCard } from "@/components/planner/SunTimesCard";
import { WeatherCard } from "@/components/planner/WeatherCard";
import { PreflightChecklist } from "@/components/planner/PreflightChecklist";

interface DockTabContentProps {
  tab: DockTab;
  waypoints: Waypoint[];
  defaultSpeed: number;
  selectedWaypointId: string | null;
  onSelectWaypoint: (id: string) => void;
}

export function DockTabContent({
  tab,
  waypoints,
  defaultSpeed,
  selectedWaypointId,
  onSelectWaypoint,
}: DockTabContentProps) {
  const t = useTranslations("planner.dock");

  switch (tab) {
    case "altitude":
      return waypoints.length === 0 ? (
        <Empty>{t("noWaypoints")}</Empty>
      ) : (
        <div className="h-full px-2 py-2">
          <AltitudeProfile
            waypoints={waypoints}
            selectedWaypointId={selectedWaypointId}
            onSelectWaypoint={onSelectWaypoint}
          />
        </div>
      );
    case "terrain":
      return waypoints.length < 2 ? (
        <Empty>{t("needTwoWaypoints")}</Empty>
      ) : (
        <Scroll>
          <TerrainProfileChart waypoints={waypoints} />
        </Scroll>
      );
    case "issues":
      return (
        <Scroll>
          <ValidationPanel waypoints={waypoints} onSelectWaypoint={onSelectWaypoint} />
        </Scroll>
      );
    case "energy":
      return (
        <Scroll>
          <div className="max-w-sm">
            <EnergyCard waypoints={waypoints} cruiseSpeedMps={defaultSpeed} />
          </div>
        </Scroll>
      );
    case "site":
      return <SiteConditions first={waypoints[0]} />;
    case "checklist":
      return (
        <Scroll>
          <PreflightChecklist />
        </Scroll>
      );
  }
}

/**
 * Sun times and weather for the plan site: the first waypoint, else the map
 * centre once it has moved off null island (0,0), else an empty-state line. It
 * owns the map-centre subscription so panning re-renders only this tab.
 */
function SiteConditions({ first }: { first: Waypoint | undefined }) {
  const t = useTranslations("planner");
  const mapCenter = usePlannerStore((s) => s.mapCenter);
  const coords = first
    ? { lat: first.lat, lon: first.lon }
    : mapCenter && (mapCenter[0] !== 0 || mapCenter[1] !== 0)
      ? { lat: mapCenter[0], lon: mapCenter[1] }
      : null;
  if (!coords) return <Empty>{t("dock.siteEmpty")}</Empty>;
  return (
    <Scroll>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-6 gap-y-3">
        <section className="flex flex-col gap-2">
          <h3 className="font-body text-[11px] font-semibold text-text-tertiary">{t("sunTimes")}</h3>
          <SunTimesCard lat={coords.lat} lon={coords.lon} />
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="font-body text-[11px] font-semibold text-text-tertiary">{t("weather.title")}</h3>
          <WeatherCard lat={coords.lat} lon={coords.lon} />
        </section>
      </div>
    </Scroll>
  );
}

function Scroll({ children }: { children: ReactNode }) {
  return <div className="h-full overflow-y-auto px-3 py-2">{children}</div>;
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-3">
      <p className="text-xs text-text-tertiary">{children}</p>
    </div>
  );
}
