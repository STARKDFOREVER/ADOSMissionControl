/**
 * ScrubNumberField: typing stays a draft until blur (never a fallback on the
 * way), Shift multiplies the arrow step by 10, a label drag scrubs one step
 * per 4 px and commits on release, and a mixed field commits only once edited.
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import { ScrubNumberField } from "@/components/ui/scrub-number-field";

afterEach(cleanup);

function field(props: Partial<Parameters<typeof ScrubNumberField>[0]> = {}) {
  const onCommit = vi.fn();
  const utils = render(
    <ScrubNumberField label="Alt" value={50} step={1} min={0} max={500} unit="m" onCommit={onCommit} {...props} />,
  );
  return { input: screen.getByLabelText("Alt") as HTMLInputElement, onCommit, ...utils };
}

describe("ScrubNumberField", () => {
  it("clearing and typing 7 commits nothing until blur, then commits 7", () => {
    const { input, onCommit } = field();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "7" } });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("7");
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("Shift+ArrowUp adds 10 steps", () => {
    const { input, onCommit } = field({ step: 0.5 });
    fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(55);
  });

  it("Shift+ArrowUp keeps the step's fraction", () => {
    const { input, onCommit } = field({ value: 25.3, step: 0.1 });
    fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(26.3);
  });

  it("a field with no label or unit renders a drag handle that scrubs", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <ScrubNumberField ariaLabel="Count" value={5} step={1} min={0} max={100} onCommit={onCommit} />,
    );
    const handle = container.querySelector<HTMLElement>("[data-scrub-handle]");
    expect(handle).not.toBeNull();
    expect(handle!.getAttribute("title")).toBe("dragToAdjust");
    fireEvent.pointerDown(handle!, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(handle!, { pointerId: 1, clientX: 140 });
    fireEvent.pointerUp(handle!, { pointerId: 1, clientX: 140 });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(15);
  });

  it("ArrowDown steps down and clamps to min", () => {
    const { input, onCommit } = field({ value: 0.4, step: 1 });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("a 40 px label drag adds 10 steps and commits on release", () => {
    const { onCommit } = field({ step: 2 });
    const handle = screen.getByText("Alt");
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 140 });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 140 });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(70);
  });

  it("an emptied field reverts instead of committing a fallback", () => {
    const { input, onCommit } = field();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("50");
  });

  it("a mixed field shows the placeholder and commits only when edited", () => {
    const { input, onCommit } = field({ mixed: true, value: undefined });
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("mixed");
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(30);
  });

  it("with onClear, an emptied field commits as not set instead of reverting", () => {
    const onClear = vi.fn();
    const { input, onCommit } = field({ onClear });
    fireEvent.change(input, { target: { value: "" } });
    expect(onClear).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onClear).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });
});
