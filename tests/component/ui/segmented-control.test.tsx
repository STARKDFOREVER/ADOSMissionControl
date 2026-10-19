/**
 * SegmentedControl: an icon-only segment keeps its label as the accessible
 * name and carries the full text as its title; arrow keys move the selection.
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SegmentedControl } from "@/components/ui/segmented-control";

afterEach(cleanup);

const OPTIONS = [
  { value: "lat" as const, label: "Horizontal", title: "Horizontal", icon: <span aria-hidden>H</span>, iconOnly: true },
  { value: "lon" as const, label: "Vertical", title: "Vertical", icon: <span aria-hidden>V</span>, iconOnly: true },
];

describe("SegmentedControl", () => {
  it("names an icon-only segment by its label and titles it", () => {
    render(<SegmentedControl value="lat" options={OPTIONS} onChange={() => {}} ariaLabel="Axis" stretch />);
    const seg = screen.getByRole("radio", { name: "Vertical" });
    expect(seg.getAttribute("title")).toBe("Vertical");
    expect(screen.getByText("Vertical").className).toContain("sr-only");
  });

  it("ArrowRight selects the next segment", () => {
    const onChange = vi.fn();
    render(<SegmentedControl value="lat" options={OPTIONS} onChange={onChange} ariaLabel="Axis" />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Horizontal" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("lon");
  });
});
