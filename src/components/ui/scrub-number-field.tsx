"use client";

/**
 * @module ui/scrub-number-field
 * @description Compact number field for inspector rows. Typing edits a draft
 * that commits on blur or Enter; partial input ("-", "3.", an emptied field)
 * never reaches the value and nothing falls back to a default while typing.
 * Dragging the label (or the unit, when there is no label) left/right scrubs
 * the value by `step` every 4 px and commits on release. ArrowUp/ArrowDown
 * step and commit. Shift multiplies the step by 10, Alt by 0.1. Results are
 * clamped to `min`/`max`. `mixed` (a batch whose values differ) shows an empty
 * field reading "Mixed" and commits only once the operator types a value.
 * An optional value passes `onClear`: emptying the field and committing then
 * clears it (back to "not set") instead of restoring the previous number.
 * @license GPL-3.0-only
 */

import { useId, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import { ChevronsLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSyncedDraft } from "@/hooks/use-synced-draft";

interface ScrubNumberFieldProps {
  value: number | null | undefined;
  onCommit: (value: number) => void;
  /** Opt-in for optional values: an emptied field commits as "not set". */
  onClear?: () => void;
  min?: number;
  max?: number;
  step: number;
  /** Shown inside the field, after the number. */
  unit?: string;
  /** Decimal places a committed value is rounded to. Defaults to the step's. */
  precision?: number;
  /** Short in-field label; doubles as the scrub handle and accessible name. */
  label?: string;
  mixed?: boolean;
  /** Shown when the field is empty (e.g. an inherited default). */
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  /** Accessible name when there is no `label`. */
  ariaLabel?: string;
  className?: string;
}

/** Pixels of horizontal drag per step. */
const PX_PER_STEP = 4;

function decimalsOf(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = String(n);
  const e = s.indexOf("e-");
  if (e >= 0) return Number(s.slice(e + 2));
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

function roundTo(n: number, places: number): number {
  const f = 10 ** Math.min(places, 10);
  return Math.round(n * f) / f;
}

function multiplier(e: { shiftKey: boolean; altKey: boolean }): number {
  if (e.shiftKey) return 10;
  if (e.altKey) return 0.1;
  return 1;
}

export function ScrubNumberField({
  value: rawValue,
  onCommit,
  onClear,
  min,
  max,
  step,
  unit,
  precision,
  label,
  mixed = false,
  placeholder,
  disabled = false,
  id,
  ariaLabel,
  className,
}: ScrubNumberFieldProps) {
  const t = useTranslations("common");
  const autoId = useId();
  const inputId = id ?? autoId;
  const inputRef = useRef<HTMLInputElement>(null);
  const value = rawValue ?? undefined;

  const format = (n: number) => String(precision === undefined ? n : roundTo(n, precision));
  const sourceText = mixed || value === undefined || !Number.isFinite(value) ? "" : format(value);
  const [draft, setDraft] = useSyncedDraft(sourceText);

  const clamp = (n: number) => {
    let out = n;
    if (min !== undefined) out = Math.max(min, out);
    if (max !== undefined) out = Math.min(max, out);
    return out;
  };
  const settle = (n: number, mult: number) =>
    clamp(roundTo(n, precision ?? Math.max(decimalsOf(step), decimalsOf(step * mult))));

  const commitValue = (n: number) => {
    setDraft(format(n));
    if (mixed || n !== value) onCommit(n);
  };

  const commitDraft = () => {
    if (draft === sourceText) return;
    if (draft.trim() === "" && onClear) {
      if (!mixed) onClear();
      return;
    }
    const n = draft.trim() === "" ? NaN : Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(sourceText);
      return;
    }
    commitValue(clamp(precision === undefined ? n : roundTo(n, precision)));
  };

  /** Value a step or a scrub starts from: the typed draft when it parses. */
  const baseValue = (): number | undefined => {
    const typed = draft.trim() === "" ? NaN : Number(draft);
    if (Number.isFinite(typed)) return typed;
    if (mixed) return undefined;
    return value !== undefined && Number.isFinite(value) ? value : undefined;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      commitDraft();
      return;
    }
    if (e.key === "Escape" && draft !== sourceText) {
      e.stopPropagation();
      setDraft(sourceText);
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const base = baseValue() ?? clamp(0);
    const mult = multiplier(e);
    const delta = step * mult * (e.key === "ArrowUp" ? 1 : -1);
    commitValue(settle(base + delta, mult));
  };

  // Scrub state lives in a ref: pointer events fire faster than renders.
  const scrub = useRef<{ pointerId: number; startX: number; start: number; next: number | null } | null>(null);

  const onHandlePointerDown = (e: PointerEvent<HTMLElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best effort; the scrub still tracks while over the handle.
    }
    scrub.current = { pointerId: e.pointerId, startX: e.clientX, start: baseValue() ?? clamp(0), next: null };
  };

  const onHandlePointerMove = (e: PointerEvent<HTMLElement>) => {
    const s = scrub.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const steps = Math.trunc((e.clientX - s.startX) / PX_PER_STEP);
    const mult = multiplier(e);
    const next = settle(s.start + steps * step * mult, mult);
    s.next = steps === 0 ? null : next;
    setDraft(format(steps === 0 ? s.start : next));
  };

  const endScrub = (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const s = scrub.current;
    if (!s || s.pointerId !== e.pointerId) return;
    scrub.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (cancelled) {
      setDraft(sourceText);
    } else if (s.next === null) {
      // A press without a drag: edit the number instead.
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      commitValue(s.next);
    }
  };

  const handleProps = disabled
    ? {}
    : {
        onPointerDown: onHandlePointerDown,
        onPointerMove: onHandlePointerMove,
        onPointerUp: (e: PointerEvent<HTMLElement>) => endScrub(e, false),
        onPointerCancel: (e: PointerEvent<HTMLElement>) => endScrub(e, true),
      };
  const handleClass = disabled ? "" : "cursor-ew-resize touch-none select-none";

  return (
    <div
      className={cn(
        "flex h-7 min-w-0 items-center rounded-sm border border-transparent bg-bg-tertiary transition-colors",
        "hover:border-border-default focus-within:border-accent-primary",
        disabled && "opacity-50",
        className,
      )}
    >
      {label && (
        <span
          {...handleProps}
          data-scrub-handle=""
          aria-hidden
          className={cn("shrink-0 pl-2 text-[11px] text-text-tertiary", handleClass)}
        >
          {label}
        </span>
      )}
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-label={ariaLabel ?? label}
        aria-valuenow={mixed || value === undefined ? undefined : value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={mixed ? t("mixed") : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={draft}
        placeholder={mixed ? t("mixed") : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={onKeyDown}
        className="h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-text-primary outline-none placeholder:font-body placeholder:text-text-tertiary disabled:cursor-not-allowed"
      />
      {unit && (
        <span
          {...(label ? {} : handleProps)}
          {...(label ? {} : { "data-scrub-handle": "" })}
          aria-hidden
          className={cn("shrink-0 pr-2 font-mono text-[11px] text-text-tertiary", !label && handleClass)}
        >
          {unit}
        </span>
      )}
      {!label && !unit && (
        <span
          {...handleProps}
          data-scrub-handle=""
          aria-hidden
          title={t("dragToAdjust")}
          className={cn("flex shrink-0 items-center pr-2 text-text-tertiary", handleClass)}
        >
          <ChevronsLeftRight size={12} />
        </span>
      )}
    </div>
  );
}
