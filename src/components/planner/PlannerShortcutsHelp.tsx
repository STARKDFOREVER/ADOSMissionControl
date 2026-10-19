/**
 * @module PlannerShortcutsHelp
 * @description Help popover body for the tool rail. Renders every entry of
 * the shared `PLANNER_SHORTCUTS` table, grouped, so the advertised keys can
 * never drift from the keys the dispatcher handles.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { isElectron } from "@/lib/utils";
import {
  PLANNER_SHORTCUTS,
  type PlannerShortcut,
  type PlannerShortcutGroup,
} from "@/lib/planner-shortcuts";

const GROUP_ORDER: readonly PlannerShortcutGroup[] = ["tool", "panel", "overlay", "edit", "file"];

/** Format a shortcut's key for display, e.g. "V", "⌘Z", "⌘⇧Z", "⇧Click". */
export function formatShortcutKey(s: PlannerShortcut): string {
  const mods = `${s.meta ? "⌘" : ""}${s.shift ? "⇧" : ""}`;
  const key = s.key.length === 1 ? s.key.toUpperCase() : s.key;
  return `${mods}${key}`;
}

export function PlannerShortcutsHelp() {
  const t = useTranslations("planner");
  // Desktop-only chords (e.g. New plan) stay native in the browser, so only
  // advertise them where the dispatcher actually handles them.
  const visible = PLANNER_SHORTCUTS.filter((s) => !s.desktopOnly || isElectron());

  return (
    <div className="flex w-64 flex-col p-3">
      <span className="mb-1 text-[11px] font-body font-semibold text-text-tertiary">
        {t("rail.help.title")}
      </span>
      {GROUP_ORDER.map((group, gi) => {
        const rows = visible.filter((s) => s.group === group);
        if (rows.length === 0) return null;
        return (
          <section
            key={group}
            className={gi > 0 ? "mt-2 border-t border-border-default pt-2" : undefined}
          >
            <h3 className="mb-1 text-[11px] font-body font-semibold text-text-tertiary">
              {t(`rail.help.groups.${group}`)}
            </h3>
            <ul className="flex flex-col gap-1">
              {rows.map((s, i) => (
                <li key={`${s.key}-${i}`} className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-text-secondary">{t(s.labelKey)}</span>
                  <kbd className="shrink-0 rounded border border-border-default bg-bg-tertiary px-1 py-0.5 font-mono text-[11px] text-text-tertiary">
                    {formatShortcutKey(s)}
                  </kbd>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
