"use client";

/**
 * @module ui/property-section
 * @description Inspector section: a hairline on top, a sentence-case header
 * and its rows below, with no card around them. Optionally collapsible; with
 * a `persistKey` the open state lives in the planner store so it survives a
 * reload, otherwise it is local to the mounted section.
 * @license GPL-3.0-only
 */

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { usePlannerStore } from "@/stores/planner-store";

interface PropertySectionProps {
  title: string;
  /** Header-right slot (a `+` button, a toggle). Sits beside the toggle,
   * never inside it. */
  action?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Key in the planner store's persisted `sectionOpen` map. */
  persistKey?: string;
}

export function PropertySection({
  title,
  action,
  children,
  collapsible = false,
  defaultOpen = true,
  persistKey,
}: PropertySectionProps) {
  const contentId = useId();
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const persisted = usePlannerStore((s) => (persistKey ? s.sectionOpen?.[persistKey] : undefined));
  const setSectionOpen = usePlannerStore((s) => s.setSectionOpen);

  const open = !collapsible || (persistKey ? (persisted ?? defaultOpen) : localOpen);
  const toggle = () => {
    if (persistKey) setSectionOpen(persistKey, !open);
    else setLocalOpen(!open);
  };

  const titleText = (
    <span className="truncate font-body text-[11px] font-semibold text-text-tertiary">{title}</span>
  );

  return (
    <section className="border-t border-border-default px-3 py-3 first:border-t-0">
      <div className="flex min-h-6 items-center gap-2">
        {collapsible ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={contentId}
            className="-ml-1 flex min-w-0 flex-1 items-center gap-1 rounded px-1 text-left cursor-pointer focus-ring"
          >
            {open ? (
              <ChevronDown size={12} className="shrink-0 text-text-tertiary" />
            ) : (
              <ChevronRight size={12} className="shrink-0 text-text-tertiary" />
            )}
            {titleText}
          </button>
        ) : (
          <h3 className="flex min-w-0 flex-1 items-center">{titleText}</h3>
        )}
        {action && <div className="flex shrink-0 items-center">{action}</div>}
      </div>
      <div id={contentId} hidden={!open} className="mt-1 flex flex-col">
        {children}
      </div>
    </section>
  );
}
