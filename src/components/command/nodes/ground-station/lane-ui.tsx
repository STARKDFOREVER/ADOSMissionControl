"use client";

/**
 * @module ground-station/lane-ui
 * @description Small presentational pieces shared by the ground-station GNSS,
 * LoRa and multi-adapter radio views: a titled card, a label/value row, a
 * tone chip and the honest "not fitted" empty state.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Placeholder for an unmeasured value; never a fabricated zero. */
export const EMPTY_VALUE = "…";

export type ChipTone = "success" | "warning" | "error" | "accent" | "muted";

const TONE_CLASS: Record<ChipTone, string> = {
  success: "border-status-success/40 bg-status-success/10 text-status-success",
  warning: "border-status-warning/40 bg-status-warning/10 text-status-warning",
  error: "border-status-error/40 bg-status-error/10 text-status-error",
  accent: "border-accent-primary/40 bg-accent-primary/10 text-accent-primary",
  muted: "border-border-default bg-bg-tertiary text-text-tertiary",
};

export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium",
        TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
  );
}

interface LaneCardProps {
  title: string;
  icon?: LucideIcon;
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function LaneCard({ title, icon: Icon, trailing, children, className }: LaneCardProps) {
  return (
    <section
      className={cn("rounded border border-border-default bg-bg-secondary p-4", className)}
      aria-label={title}
    >
      <div className="mb-3 flex items-center gap-2">
        {Icon ? <Icon size={14} className="shrink-0 text-accent-primary" /> : null}
        <h2 className="flex-1 text-sm font-semibold text-text-primary">{title}</h2>
        {trailing}
      </div>
      {children}
    </section>
  );
}

export function StatRow({ label, value, valueClass }: { label: string; value: ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-default py-1.5 last:border-b-0">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className={cn("text-right font-mono text-xs tabular-nums", valueClass ?? "text-text-primary")}>
        {value}
      </dd>
    </div>
  );
}

export function NotFitted({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border-default bg-bg-secondary text-text-tertiary">
        <Icon size={24} />
      </div>
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      <p className="mt-2 max-w-sm text-xs text-text-tertiary">{body}</p>
    </div>
  );
}

/** Format a finite number to fixed digits, or the empty placeholder. */
export function fmtNum(v: unknown, digits = 0): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : EMPTY_VALUE;
}
