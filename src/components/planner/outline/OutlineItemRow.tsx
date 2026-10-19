"use client";

/**
 * @module outline/OutlineItemRow
 * @description A plain outline row for shapes, fence zones, rally points and
 * POIs: a label and a numeric detail, a click that points the inspector at
 * the item, and an optional hover delete.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface OutlineItemRowProps {
  icon?: ReactNode;
  label: string;
  /** Numbers and units shown right of the label. */
  detail?: string;
  active: boolean;
  onSelect: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}

export function OutlineItemRow({ icon, label, detail, active, onSelect, onRemove, removeLabel }: OutlineItemRowProps) {
  return (
    <div
      className={cn(
        "group/row flex h-7 items-center gap-1 pl-6 pr-2 transition-colors",
        active ? "bg-accent-primary/10" : "hover:bg-bg-tertiary",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded text-left cursor-pointer focus-ring"
      >
        {icon && (
          <span className={cn("flex shrink-0 items-center", active ? "text-accent-primary" : "text-text-tertiary")}>
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] text-text-primary">{label}</span>
        {detail && <span className="shrink-0 font-mono text-[11px] text-text-tertiary">{detail}</span>}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-tertiary opacity-0 transition-opacity hover:text-status-error group-hover/row:opacity-100 focus-visible:opacity-100 cursor-pointer focus-ring"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/** Muted one-line note for an empty group. */
export function OutlineEmpty({ children }: { children: ReactNode }) {
  return <p className="py-1 pl-7 pr-3 text-[11px] text-text-tertiary">{children}</p>;
}
