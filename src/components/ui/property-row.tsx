/**
 * @module ui/property-row
 * @description One inspector row: label on the left (96 px), the control in
 * the middle, an optional trailing slot. 28 px tall; a long label wraps onto
 * a second line instead of truncating, and the row grows only then.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";

interface PropertyRowProps {
  label: ReactNode;
  /** Longer explanation, shown as the label's tooltip. */
  hint?: string;
  children: ReactNode;
  trailing?: ReactNode;
  /** Id of the control the label names. */
  htmlFor?: string;
}

export function PropertyRow({ label, hint, children, trailing, htmlFor }: PropertyRowProps) {
  const labelClass = "break-words py-1 text-xs leading-tight text-text-secondary";
  return (
    <div className={trailing
      ? "grid min-h-7 grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-x-2"
      : "grid min-h-7 grid-cols-[96px_minmax(0,1fr)] items-center gap-x-2"}>
      {htmlFor ? (
        <label htmlFor={htmlFor} title={hint} className={labelClass}>
          {label}
        </label>
      ) : (
        <span title={hint} className={labelClass}>
          {label}
        </span>
      )}
      <div className="min-w-0">{children}</div>
      {trailing && <div className="flex items-center">{trailing}</div>}
    </div>
  );
}
