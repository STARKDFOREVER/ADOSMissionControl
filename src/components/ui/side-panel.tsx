"use client";

/**
 * @module ui/side-panel
 * @description Collapsible docked panel that stays mounted while closed, so
 * the state inside it (drafts, scroll, expanded rows) survives a toggle. When
 * closed it is zero-width, clipped and `inert`. The width change is the one
 * layout transition (180 ms); a keyboard toggle passes `animate={false}` so
 * the panel snaps.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SidePanelProps {
  side: "left" | "right";
  open: boolean;
  /** Open width in px. */
  width: number;
  children: ReactNode;
  ariaLabel: string;
  /** Animate the width change. False for keyboard-triggered toggles. */
  animate?: boolean;
}

export function SidePanel({ side, open, width, children, ariaLabel, animate = true }: SidePanelProps) {
  return (
    <aside
      aria-label={ariaLabel}
      inert={!open}
      style={open ? { width } : undefined}
      className={cn(
        "relative h-full shrink-0 overflow-hidden bg-bg-primary",
        !open && "w-0",
        open && (side === "left" ? "border-r border-border-default" : "border-l border-border-default"),
        animate && "transition-[width] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
      )}
    >
      {/* Fixed-width content: the panel clips it while the width animates, so
          nothing reflows mid-transition. */}
      <div
        style={{ width }}
        className={cn("flex h-full flex-col", side === "right" && "absolute inset-y-0 right-0")}
      >
        {children}
      </div>
    </aside>
  );
}
