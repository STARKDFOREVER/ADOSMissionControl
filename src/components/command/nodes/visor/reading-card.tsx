/**
 * @module visor/reading-card
 * @description The small card, label/value row and empty state the Visor
 * Overview and Sensors tabs compose their readings from.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LEVEL_TEXT, type RateLevel } from "./sensor-format";

export function ReadingCard({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="h-full space-y-1.5 rounded-lg border border-border-default bg-bg-secondary p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
          {title}
        </h3>
        {trailing}
      </div>
      {children}
    </div>
  );
}

export function ReadingRow({
  label,
  value,
  level,
}: {
  label: string;
  value: string;
  level?: RateLevel;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-text-tertiary">{label}</span>
      <span className={cn("truncate font-mono text-text-primary", level && LEVEL_TEXT[level])}>
        {value}
      </span>
    </div>
  );
}

export function ReadingEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-default p-6 text-center">
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="mt-1 text-xs text-text-tertiary">{body}</p>
    </div>
  );
}
