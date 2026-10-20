"use client";

/**
 * @module outline/OutlineRowMenu
 * @description Right-click menu of a waypoint row in the plan outline:
 * "Resume from here…" opens the Send dialog in resume mode at that waypoint.
 * The first waypoint cannot be resumed from (the plan already starts there),
 * so its item stays focusable but disabled, with the reason as its title.
 * Escape and a click elsewhere close the menu.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAP_OVERLAY_Z } from "@/lib/map-overlay-z";
import { usePlannerStore } from "@/stores/planner-store";

interface OutlineRowMenuProps {
  /** Planner index of the row's waypoint. */
  index: number;
  /** Waypoints in the plan. */
  count: number;
  x: number;
  y: number;
  onClose: () => void;
}

export function OutlineRowMenu({ index, count, x, y, onClose }: OutlineRowMenuProps) {
  const t = useTranslations("planner.outline");
  const ref = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  const resumable = index > 0 && index < count;

  useEffect(() => {
    itemRef.current?.focus();
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Capture-phase stop: Escape closes this menu and nothing behind it.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  const reason = resumable ? undefined : t("resumeFirstReason");

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t("rowMenu", { n: index + 1 })}
      className="fixed min-w-[180px] border border-border-default bg-bg-primary py-1 shadow-lg"
      style={{ left: x, top: y, zIndex: MAP_OVERLAY_Z.popover }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        ref={itemRef}
        type="button"
        role="menuitem"
        aria-disabled={!resumable || undefined}
        title={reason}
        onClick={() => {
          if (!resumable) return;
          usePlannerStore.getState().openSendDialog({ resumeFromIndex: index });
          onClose();
        }}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors focus-ring",
          resumable ? "cursor-pointer text-text-primary hover:bg-bg-tertiary" : "cursor-not-allowed text-text-tertiary",
        )}
      >
        <Play size={12} aria-hidden />
        {t("resumeFromHere")}
      </button>
    </div>
  );
}
