/**
 * @module PatternGallery
 * @description Popover body opened from the tool rail's Pattern button. The
 * Patterns tab is a grid of every flight-pattern type; picking one activates
 * it and points the inspector at the pattern editor. The Templates tab hosts
 * the built-in mission templates.
 * @license GPL-3.0-only
 */
"use client";

import { useState, type ComponentType } from "react";
import { useTranslations } from "next-intl";
import {
  Grid3x3, Orbit, Spline, Square, SquareDashed, Radar, Rows3, Building2,
  PlaneLanding, ArrowDownToLine, BrickWall,
} from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TemplatesPanel } from "./TemplatesPanel";
import { PATTERN_TYPE_OPTIONS } from "./pattern-editor-constants";
import { selectPatternType } from "@/stores/pattern-selection";
import { usePatternStore, type PatternType } from "@/stores/pattern-store";
import { usePlannerStore } from "@/stores/planner-store";
import { cn } from "@/lib/utils";

const PATTERN_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  survey: Grid3x3,
  orbit: Orbit,
  corridor: Spline,
  facade: BrickWall,
  perimeter: Square,
  expandingSquare: SquareDashed,
  sectorSearch: Radar,
  parallelTrack: Rows3,
  structureScan: Building2,
  fixedWingLanding: PlaneLanding,
  vtolLanding: ArrowDownToLine,
};

type GalleryTab = "patterns" | "templates";

/** Activate a pattern type and open the inspector on the pattern editor. */
export function pickPattern(type: PatternType): void {
  if (usePatternStore.getState().activePatternType !== type) selectPatternType(type);
  const planner = usePlannerStore.getState();
  planner.setInspectorTarget({ kind: "pattern" });
  if (!planner.inspectorOpen) planner.toggleInspector();
}

export function PatternGallery({ onPicked }: { onPicked: () => void }) {
  const t = useTranslations("planner.rail");
  const [tab, setTab] = useState<GalleryTab>("patterns");
  const activeType = usePatternStore((s) => s.activePatternType);

  return (
    <div className="flex w-72 flex-col gap-2 p-2">
      <SegmentedControl<GalleryTab>
        value={tab}
        onChange={setTab}
        size="sm"
        stretch
        ariaLabel={t("gallery.ariaLabel")}
        options={[
          { value: "patterns", label: t("gallery.patternsTab") },
          { value: "templates", label: t("gallery.templatesTab") },
        ]}
      />
      {tab === "patterns" ? (
        <div className="grid grid-cols-2 gap-1">
          {PATTERN_TYPE_OPTIONS.map((o) => {
            const Icon = PATTERN_ICONS[o.value] ?? Grid3x3;
            const active = activeType === o.value;
            return (
              <button
                key={o.value}
                type="button"
                data-pattern={o.value}
                onClick={() => {
                  pickPattern(o.value as PatternType);
                  onPicked();
                }}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 rounded-md px-1 text-[11px] font-body transition-colors cursor-pointer",
                  active
                    ? "bg-accent-primary/15 text-accent-primary"
                    : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary",
                )}
              >
                <Icon size={16} />
                <span className="text-center leading-tight">{t(`patternTypes.${o.value}`)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <TemplatesPanel />
      )}
    </div>
  );
}
