/**
 * @module PlannerViewToggle
 * @description The planner bar's "2D | 3D" segmented control.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlannerStore } from "@/stores/planner-store";

export function PlannerViewToggle() {
  const t = useTranslations("planner.view3d");
  const mapView = usePlannerStore((s) => s.mapView);
  const setMapView = usePlannerStore((s) => s.setMapView);
  const segment = (view: "2d" | "3d", label: string) => (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={mapView === view}
      title={t("title")}
      className={cn(mapView === view && "bg-bg-tertiary text-text-primary")}
      onClick={() => setMapView(view)}
    >
      {label}
    </Button>
  );
  return (
    <div role="group" aria-label={t("title")} className="flex items-center rounded border border-border-default">
      {segment("2d", t("label2d"))}
      {segment("3d", t("label3d"))}
    </div>
  );
}
