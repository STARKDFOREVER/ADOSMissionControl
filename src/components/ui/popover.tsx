"use client";

/**
 * @module ui/popover
 * @description Portaled, non-modal popup anchored to a trigger. The caller
 * owns `open` and the trigger; the popover positions itself beside the anchor
 * (`useAnchoredPosition`), closes on an outside press or Escape, and puts
 * focus back on the anchor when it closes with focus inside it. It grows out
 * of the trigger side: 150 ms from `scale(0.97)` and transparent, opacity only
 * under reduced motion.
 * @license GPL-3.0-only
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useAnchoredPosition, type AnchoredPlacement } from "./use-anchored-position";

export type PopoverSide = "right" | "bottom" | "left";
export type PopoverAlign = "start" | "center" | "end";

interface PopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: PopoverSide;
  align?: PopoverAlign;
  children: ReactNode;
  /** Extra classes for the popup surface (width, padding). */
  className?: string;
  /** Accessible name for the popup region. */
  ariaLabel?: string;
}

const BOTTOM_ALIGN = { start: "left", center: "center", end: "right" } as const;
const CROSS_ORIGIN = { start: "top", center: "center", end: "bottom" } as const;
const MAIN_ORIGIN = { start: "left", center: "center", end: "right" } as const;

function transformOrigin(placement: AnchoredPlacement, align: PopoverAlign): string {
  switch (placement) {
    case "bottom":
      return `top ${MAIN_ORIGIN[align]}`;
    case "top":
      return `bottom ${MAIN_ORIGIN[align]}`;
    case "right":
      return `left ${CROSS_ORIGIN[align]}`;
    case "left":
      return `right ${CROSS_ORIGIN[align]}`;
  }
}

export function Popover({
  anchorRef,
  open,
  onOpenChange,
  side = "bottom",
  align = "start",
  children,
  className,
  ariaLabel,
}: PopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const { style, compute, placement } = useAnchoredPosition(anchorRef, open, {
    side,
    align: BOTTOM_ALIGN[align],
    crossAlign: align,
    gap: 6,
    maxHeight: 480,
    estimatedWidth: 280,
  });

  // Position before the first paint so the popup never flashes at the origin.
  useLayoutEffect(() => {
    if (open) compute();
  }, [open, compute]);

  // Take focus on open so keyboard users land inside; on close, hand it back
  // to the anchor when it was inside the popup (now detached, so the document
  // reports `body`).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      popRef.current?.focus({ preventScroll: true });
    } else if (wasOpen.current) {
      const active = document.activeElement;
      if (!active || active === document.body) anchorRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // Capture phase plus stopPropagation keeps the planner's document-level
      // (bubble) Escape handler from also acting.
      e.stopPropagation();
      onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onOpenChange, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div style={style} className="flex flex-col">
      <div
        ref={popRef}
        role="dialog"
        aria-label={ariaLabel}
        tabIndex={-1}
        style={{ transformOrigin: transformOrigin(placement, align) }}
        className={cn(
          "min-h-0 overflow-y-auto rounded-md border border-border-default bg-bg-secondary shadow-lg outline-none",
          "transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
          "starting:scale-[0.97] starting:opacity-0 motion-reduce:starting:scale-100",
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
