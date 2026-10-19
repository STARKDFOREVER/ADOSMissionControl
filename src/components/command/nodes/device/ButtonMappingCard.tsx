"use client";

/**
 * @module ButtonMappingCard
 * @description The front-panel button mapping: one action picker per button
 * press (short and long for B1–B4). Save sends the whole mapping; a press
 * left unassigned falls back to the profile default on the node. An action
 * the node reports but this app does not know stays selectable under its raw
 * name, so a save never rewrites it.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { HintChip } from "@/components/hardware/HintChip";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import {
  PANEL_BUTTONS,
  PANEL_BUTTON_ACTIONS,
} from "@/lib/api/ground-station/types/ui";

const PRESSES = ["short", "long"] as const;

export interface ButtonMappingCardProps {
  /** The node's mapping, or null before it has been read. */
  mapping: Record<string, string> | null;
  /** Persist the edited mapping (the node's echo arrives as a new `mapping`). */
  onSave: (mapping: Record<string, string>) => Promise<void>;
}

export function ButtonMappingCard({ mapping, onSave }: ButtonMappingCardProps) {
  const t = useTranslations("hardware.buttons");
  const [draft, setDraft] = useState<Record<string, string>>(mapping ?? {});
  const [saving, setSaving] = useState(false);

  // A fresh read (or the node's echo after a save) replaces the draft.
  useEffect(() => {
    setDraft(mapping ?? {});
  }, [mapping]);

  const known = useMemo<SelectOption[]>(
    () => [
      { value: "", label: t("unassigned") },
      ...PANEL_BUTTON_ACTIONS.map((a) => ({ value: a, label: t(`actions.${a}`) })),
    ],
    [t],
  );

  const dirty = useMemo(() => {
    const base = mapping ?? {};
    const keys = new Set([...Object.keys(base), ...Object.keys(draft)]);
    return [...keys].some((k) => (base[k] ?? "") !== (draft[k] ?? ""));
  }, [mapping, draft]);

  const optionsFor = (value: string): SelectOption[] =>
    value === "" || known.some((o) => o.value === value)
      ? known
      : [...known, { value, label: value }];

  const setPress = (key: string, value: string) =>
    setDraft((prev) => {
      const next = { ...prev };
      if (value === "") delete next[key];
      else next[key] = value;
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium text-text-primary">{t("title")}</h2>
        <HintChip>{t("bindingHint")}</HintChip>
      </div>
      <div className="overflow-hidden rounded border border-border-default">
        <table className="w-full text-sm">
          <thead className="bg-bg-tertiary text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="px-3 py-2 text-left">{t("button")}</th>
              <th className="px-3 py-2 text-left">{t("shortPress")}</th>
              <th className="px-3 py-2 text-left">{t("longPress")}</th>
            </tr>
          </thead>
          <tbody>
            {PANEL_BUTTONS.map((id) => (
              <tr key={id} className="border-t border-border-default">
                <td className="px-3 py-2 font-mono text-text-primary">{id}</td>
                {PRESSES.map((press) => {
                  const key = `${id}_${press}`;
                  const value = draft[key] ?? "";
                  return (
                    <td key={press} className="px-3 py-1.5">
                      <Select
                        compact
                        ariaLabel={t("pickerLabel", {
                          button: id,
                          press: t(press === "short" ? "shortPress" : "longPress"),
                        })}
                        options={optionsFor(value)}
                        value={value}
                        onChange={(v) => setPress(key, v)}
                        disabled={mapping === null || saving}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-text-secondary">
          {mapping === null ? t("notRead") : t("passthroughNote")}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDraft(mapping ?? {})}
            disabled={!dirty || saving}
          >
            {t("reset")}
          </Button>
          <Button variant="primary" size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </section>
  );
}
