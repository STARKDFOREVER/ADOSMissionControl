/**
 * ConfirmSheet safety behaviour: the kill guard lapses at its window unless a
 * hold started, a checklist override is recorded, a held gamepad button
 * confirms, Escape cancels, the title names the drone, and a stale-link send
 * says the vehicle may not receive it.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../locales/en.json";
import { ConfirmSheet } from "@/components/cockpit/confirm/ConfirmSheet";
import {
  CONFIRM_HOLD_DEFAULT_MS,
  GUARD_WINDOW_MS,
  type ConfirmPolicy,
} from "@/lib/skills/types";
import { useChecklistStore } from "@/stores/checklist-store";
import { useInputStore } from "@/stores/input-store";

const STALE_TEXT = "The vehicle may not receive this";
const TEST_MESSAGES = {
  ...messages,
  cockpit: {
    ...messages.cockpit,
    confirm: { ...messages.cockpit.confirm, staleLink: STALE_TEXT },
  },
  testSheet: { title: "Arm {drone}", message: "Confirm", button: "Go" },
};

const BASE: ConfirmPolicy = {
  title: "testSheet.title",
  message: "testSheet.message",
  confirmLabel: "testSheet.button",
  variant: "danger",
  gesture: "hold",
};

function renderSheet(policy: ConfirmPolicy, droneId: string | null = "drone-1") {
  const onResolve = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={TEST_MESSAGES}>
      <ConfirmSheet policy={policy} droneId={droneId} onResolve={onResolve} />
    </NextIntlClientProvider>,
  );
  return onResolve;
}

function holdControl(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-hold-control='true']");
  if (!el) throw new Error("hold control not rendered");
  return el;
}

describe("ConfirmSheet", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    useInputStore.setState({ buttons: [] });
  });

  it("cancels a guarded request when the guard window lapses with no hold", () => {
    const onResolve = renderSheet({ ...BASE, gesture: "guarded" });
    act(() => {
      vi.advanceTimersByTime(GUARD_WINDOW_MS + 10);
    });
    expect(onResolve).toHaveBeenCalledWith(false, undefined);
  });

  it("lets a hold started inside the guard window finish", () => {
    const onResolve = renderSheet({ ...BASE, gesture: "guarded" });
    act(() => {
      vi.advanceTimersByTime(GUARD_WINDOW_MS - 500);
    });
    fireEvent.pointerDown(holdControl(), { pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(CONFIRM_HOLD_DEFAULT_MS.guarded + 10);
    });
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith(true, undefined);
  });

  it("records a checklist override as a safety event", () => {
    useChecklistStore.getState().startSession("drone-1");
    const onResolve = renderSheet({
      ...BASE,
      title: "skills.arm.confirm.title",
      checklistAware: true,
    });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.pointerDown(holdControl(), { pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(CONFIRM_HOLD_DEFAULT_MS.hold + 10);
    });
    expect(onResolve).toHaveBeenCalledWith(true, undefined);
    const rows = JSON.parse(localStorage.getItem("ados:flight-safety-overrides") ?? "[]");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "arm", reason: "preflight_incomplete" });
  });

  it("confirms while the gamepad button that opened it is held", () => {
    const onResolve = renderSheet({ ...BASE, gamepadButton: 2 });
    act(() => {
      useInputStore.setState({ buttons: [false, false, true] });
    });
    act(() => {
      vi.advanceTimersByTime(CONFIRM_HOLD_DEFAULT_MS.hold + 10);
    });
    expect(onResolve).toHaveBeenCalledWith(true, undefined);
  });

  it("cancels on Escape", () => {
    const onResolve = renderSheet(BASE);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onResolve).toHaveBeenCalledWith(false, undefined);
  });

  it("names the drone and warns on a stale link", () => {
    renderSheet({ ...BASE, values: { drone: "Survey One" }, staleLink: true });
    expect(screen.getByText("Arm Survey One")).toBeTruthy();
    expect(screen.getByText(STALE_TEXT)).toBeTruthy();
  });

  it("shows no stale-link warning on a fresh link", () => {
    renderSheet(BASE);
    expect(screen.queryByText(STALE_TEXT)).toBeNull();
  });
});
