/**
 * @module select-types
 * @description Types and helper functions for the Select component.
 * @license GPL-3.0-only
 */

import type { SelectOption, SelectOptionGroup } from "@/lib/types";

export interface SelectProps {
  label?: React.ReactNode;
  options: SelectOption[] | SelectOptionGroup[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Placeholder shown when no value is selected. */
  placeholder?: string;
  disabled?: boolean;
  /** Enable type-to-filter search. Default false. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Max dropdown height in px. Default 280. */
  maxHeight?: number;
  /** Accessible name when there is no visible `label` (e.g. inside a labelled row). */
  ariaLabel?: string;
  /** Inspector-row size: 28 px tall with 12 px text, matching the number fields. */
  compact?: boolean;
}

export function isGrouped(
  options: SelectOption[] | SelectOptionGroup[],
): options is SelectOptionGroup[] {
  return options.length > 0 && "options" in options[0];
}

export function flattenOptions(
  options: SelectOption[] | SelectOptionGroup[],
): SelectOption[] {
  if (isGrouped(options)) {
    return options.flatMap((g) => g.options);
  }
  return options as SelectOption[];
}
