/**
 * @module PatternNumberRow
 * @description One inspector row holding a scrub number field, shared by the
 * pattern config sections. The row label doubles as the field's accessible
 * name. The field commits on blur, Enter, arrow step or scrub, never while
 * the operator is still typing.
 * @license GPL-3.0-only
 */
"use client";

import { PropertyRow } from "@/components/ui/property-row";
import { ScrubNumberField } from "@/components/ui/scrub-number-field";

interface PatternNumberRowProps {
  label: string;
  hint?: string;
  value: number | null | undefined;
  onCommit: (value: number) => void;
  /** Optional values only: an emptied field commits as "not set". */
  onClear?: () => void;
  step: number;
  min?: number;
  max?: number;
  unit?: string;
  precision?: number;
  placeholder?: string;
  disabled?: boolean;
}

export function PatternNumberRow({ label, hint, ...field }: PatternNumberRowProps) {
  return (
    <PropertyRow label={label} hint={hint}>
      <ScrubNumberField ariaLabel={label} {...field} />
    </PropertyRow>
  );
}
