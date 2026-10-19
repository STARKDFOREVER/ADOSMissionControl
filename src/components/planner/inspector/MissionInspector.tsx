/**
 * @module MissionInspector
 * @description What the inspector shows with nothing selected: the defaults
 * new waypoints take, a template picker while the plan is empty, and one row
 * per plan element (pattern, geofence, rally, POI) that opens its editor.
 * @license GPL-3.0-only
 */
"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { PropertySection } from "@/components/ui/property-section";
import { usePlannerStore, type InspectorTarget } from "@/stores/planner-store";
import { usePatternStore } from "@/stores/pattern-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { usePlanPoiStore } from "@/stores/plan-poi-store";
import { DefaultsSection } from "../DefaultsSection";
import { TemplatesPanel } from "../TemplatesPanel";
import { VALID_PATTERN_TYPES } from "../pattern-editor-constants";
import type { Planner } from "@/app/plan/use-planner";

interface MissionInspectorProps {
  p: Planner;
  showGeofence: boolean;
  showRally: boolean;
}

export function MissionInspector({ p, showGeofence, showRally }: MissionInspectorProps) {
  const t = useTranslations("planner.inspector.mission");
  const setInspectorTarget = usePlannerStore((s) => s.setInspectorTarget);
  const activePattern = usePatternStore((s) => s.activePatternType);
  const geofenceEnabled = useGeofenceStore((s) => s.enabled);
  const poiCount = usePlanPoiStore((s) => s.points.length);
  const tTypes = useTranslations("planner.rail.patternTypes");
  const patternLabel = activePattern && VALID_PATTERN_TYPES.has(activePattern)
    ? tTypes(activePattern as Parameters<typeof tTypes>[0])
    : undefined;
  const open = (target: InspectorTarget) => () => setInspectorTarget(target);

  return (
    <>
      <PropertySection title={t("defaults")} collapsible persistKey="inspector.mission.defaults">
        <DefaultsSection defaultAlt={p.defaultAlt} defaultSpeed={p.defaultSpeed}
          defaultAcceptRadius={p.defaultAcceptRadius} defaultFrame={p.defaultFrame}
          onAltChange={(v) => p.setDefaults({ defaultAlt: v })}
          onSpeedChange={(v) => p.setDefaults({ defaultSpeed: v })}
          onRadiusChange={(v) => p.setDefaults({ defaultAcceptRadius: v })}
          onFrameChange={(v) => p.setDefaults({ defaultFrame: v })} />
      </PropertySection>

      {p.waypoints.length === 0 && (
        <PropertySection title={t("startFromTemplate")}>
          <TemplatesPanel />
        </PropertySection>
      )}

      <PropertySection title={t("elements")}>
        <QuickEntryRow label={t("pattern")} value={patternLabel ?? t("none")} onClick={open({ kind: "pattern" })} />
        {showGeofence && (
          <QuickEntryRow label={t("geofence")} value={geofenceEnabled ? t("on") : t("off")}
            onClick={open({ kind: "geofence" })} />
        )}
        {showRally && (
          <QuickEntryRow label={t("rally")} value={<span className="font-mono">{p.rallyPoints.length}</span>}
            onClick={open({ kind: "rally", id: null })} />
        )}
        <QuickEntryRow label={t("poi")} value={<span className="font-mono">{poiCount}</span>}
          onClick={open({ kind: "poi", id: null })} />
        <QuickEntryRow label={t("transform")} value={null} onClick={open({ kind: "transform" })} />
      </PropertySection>
    </>
  );
}

/** A full-width row that opens another inspector target. */
function QuickEntryRow({ label, value, onClick }: { label: string; value: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="-mx-1 grid min-h-7 grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-sm px-1 text-left cursor-pointer transition-colors hover:bg-bg-tertiary focus-ring">
      <span className="break-words py-1 text-xs leading-tight text-text-secondary">{label}</span>
      <span className="truncate text-xs text-text-primary">{value}</span>
      <ChevronRight size={12} className="text-text-tertiary" />
    </button>
  );
}
