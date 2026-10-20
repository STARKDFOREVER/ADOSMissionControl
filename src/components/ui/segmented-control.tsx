"use client";

/**
 * @module ui/segmented-control
 * @description Single-choice control for a short enum (four options or
 * fewer). A radio group: one segment is tabbable, the arrow keys move and
 * select, Home/End jump to the ends. Only the selected segment carries the
 * accent.
 * @license GPL-3.0-only
 */

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  title?: string;
  /** Show only the icon; the label stays as the segment's accessible name.
   * Give such a segment a `title` so pointer users see the full text too. */
  iconOnly?: boolean;
  /** Unavailable: the segment stays visible and focusable but cannot be
   * picked, and the arrow keys pass over it. Put the reason in `title`. */
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  ariaLabel: string;
  /** Stretch each segment to equal width to fill the container. */
  stretch?: boolean;
  className?: string;
  /** Replaces the default type treatment (size and weight) of every segment,
   * for a host surface with its own text style. */
  segmentClassName?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  ariaLabel,
  stretch,
  className,
  segmentClassName,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const move = (index: number) => {
    const next = options[index];
    if (!next) return;
    refs.current[index]?.focus();
    if (next.value !== value) onChange(next.value);
  };

  /** The next enabled segment from `from` stepping by `step`, else `from`. */
  const nextEnabled = (from: number, step: 1 | -1) => {
    const count = options.length;
    for (let k = 1; k <= count; k++) {
      const i = (((from + step * k) % count) + count) % count;
      if (!options[i].disabled) return i;
    }
    return from;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const count = options.length;
    if (count === 0) return;
    const from = selectedIndex >= 0 ? selectedIndex : 0;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(nextEnabled(from, 1));
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(nextEnabled(from, -1));
        break;
      case "Home":
        e.preventDefault();
        move(nextEnabled(count - 1, 1));
        break;
      case "End":
        e.preventDefault();
        move(nextEnabled(0, -1));
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn("flex gap-1", className)}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={o.disabled || undefined}
            tabIndex={i === tabbableIndex ? 0 : -1}
            title={o.title}
            onClick={() => {
              if (!selected && !o.disabled) onChange(o.value);
            }}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded whitespace-nowrap transition-colors focus-ring",
              o.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              // A stretched segment is sized by the container, so it keeps
              // almost no padding and gives the width to its text.
              stretch ? "flex-1 min-w-0 px-0.5" : "px-2",
              size === "sm" ? "h-6" : "h-7",
              segmentClassName ?? (size === "sm" ? "text-[11px] font-medium" : "text-xs font-medium"),
              selected
                ? "bg-accent-primary text-accent-foreground"
                : cn("border border-border-default text-text-secondary", !o.disabled && "hover:text-text-primary"),
            )}
          >
            {o.icon}
            <span className={o.iconOnly ? "sr-only" : "truncate"}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
