"use client";

/**
 * @module ui/use-anchored-position
 * @description Viewport positioning for popups that render through a portal.
 *
 * The Select component established the pattern this hook packages: render the
 * popup into `document.body` with `position: fixed`, compute its slot from the
 * trigger's viewport rect, flip above the trigger when the space below cannot
 * hold it, and recompute on any scroll or resize while open. A popup rendered
 * in place instead inherits every ancestor's clipping — a wrapper that scrolls
 * on one axis becomes a scroll container on both (a non-`visible` overflow on
 * either axis computes the other to `auto`), and no z-index escapes a scroll
 * container's clip.
 *
 * Callers invoke `compute()` immediately before opening so the first paint is
 * already positioned; the hook only owns the reposition listeners.
 *
 * @license GPL-3.0-only
 */

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

export interface AnchoredPositionOptions {
  /** Trigger side the popup opens on. `bottom` flips above when the space
   * below cannot hold it; `right`/`left` flip to the other side when the
   * requested one cannot hold `estimatedWidth`. */
  side?: "bottom" | "right" | "left";
  /** For `side: "bottom"`: which trigger edge the popup's matching edge sticks
   * to, or `center` to centre on the trigger. */
  align?: "left" | "right" | "center";
  /** For `side: "right" | "left"`: whether the popup's top, middle or bottom
   * lines up with the trigger's. */
  crossAlign?: "start" | "center" | "end";
  /** Gap between the trigger and the popup, in px. */
  gap?: number;
  /** Popup height cap; also the space needed below before flipping above. */
  maxHeight?: number;
  /** Estimated popup width, used only to keep a left-aligned popup on screen. */
  estimatedWidth?: number;
}

/** Side the popup actually opened on after any flip. */
export type AnchoredPlacement = "bottom" | "top" | "right" | "left";

export interface AnchoredPosition {
  /** Spread onto the portaled popup. Includes the `maxHeight` cap, so give the
   * popup its own inner scroll (`overflow-y-auto`). */
  style: CSSProperties;
  /** Recompute from the anchor's current rect. Call right before opening. */
  compute: () => void;
  /** Resolved side, for a transform origin that grows out of the trigger. */
  placement: AnchoredPlacement;
}

interface Slot {
  offsets: CSSProperties;
  maxHeight: number;
  placement: AnchoredPlacement;
}

export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  {
    side = "bottom",
    align = "left",
    crossAlign = "start",
    gap = 4,
    maxHeight = 280,
    estimatedWidth = 160,
  }: AnchoredPositionOptions = {},
): AnchoredPosition {
  const [slot, setSlot] = useState<Slot>({
    offsets: { top: 0, left: 0 },
    maxHeight,
    placement: side === "bottom" ? "bottom" : side,
  });

  const compute = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof window === "undefined") return;
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (side === "bottom") {
      const spaceBelow = vh - rect.bottom;
      const flip = spaceBelow < maxHeight && rect.top > spaceBelow;
      let horizontal: CSSProperties;
      if (align === "right") {
        horizontal = { right: Math.max(8, vw - rect.right) };
      } else if (align === "center") {
        horizontal = { left: rect.left + rect.width / 2, transform: "translateX(-50%)" };
      } else {
        let left = rect.left;
        if (left + estimatedWidth > vw - 8) {
          left = Math.max(8, vw - estimatedWidth - 8);
        }
        horizontal = { left };
      }
      setSlot({
        offsets: {
          ...horizontal,
          ...(flip ? { bottom: vh - rect.top + gap } : { top: rect.bottom + gap }),
        },
        maxHeight,
        placement: flip ? "top" : "bottom",
      });
      return;
    }

    const roomRight = vw - rect.right - gap;
    const roomLeft = rect.left - gap;
    let placement: "right" | "left" = side;
    if (side === "right" && roomRight < estimatedWidth && roomLeft > roomRight) placement = "left";
    if (side === "left" && roomLeft < estimatedWidth && roomRight > roomLeft) placement = "right";
    const horizontal: CSSProperties =
      placement === "right" ? { left: rect.right + gap } : { right: vw - rect.left + gap };
    let vertical: CSSProperties;
    let cap = maxHeight;
    if (crossAlign === "center") {
      vertical = { top: rect.top + rect.height / 2, transform: "translateY(-50%)" };
    } else if (crossAlign === "end") {
      vertical = { bottom: Math.max(8, vh - rect.bottom) };
      cap = Math.min(maxHeight, Math.max(0, rect.bottom - 8));
    } else {
      vertical = { top: Math.max(8, rect.top) };
      cap = Math.min(maxHeight, Math.max(0, vh - Math.max(8, rect.top) - 8));
    }
    setSlot({ offsets: { ...horizontal, ...vertical }, maxHeight: cap, placement });
  }, [anchorRef, side, align, crossAlign, estimatedWidth, gap, maxHeight]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => compute();
    window.addEventListener("scroll", reposition, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", reposition, { passive: true });
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, compute]);

  const style: CSSProperties = {
    position: "fixed",
    zIndex: 3000,
    maxHeight: slot.maxHeight,
    ...slot.offsets,
  };

  return { style, compute, placement: slot.placement };
}
