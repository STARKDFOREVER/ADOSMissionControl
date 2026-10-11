import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import {
  CompassStreamCard,
  decimateMag,
  type CompassStreamClient,
} from "../CompassStreamCard";
import { RingBuffer } from "@/lib/ring-buffer";
import type { MagneticFieldStrength2 } from "@/lib/dronecan/dsdl/magnetic-field-strength-2";

afterEach(() => {
  vi.useRealTimers();
});

describe("decimateMag", () => {
  it("keeps at most two points per pixel column per axis", () => {
    const ring = new RingBuffer<{ ts: number; x: number; y: number; z: number }>(5000);
    for (let i = 0; i < 5000; i++) {
      ring.push({ ts: i, x: Math.sin(i), y: Math.cos(i), z: i % 7 });
    }
    const plot = decimateMag(ring, 320);
    expect(plot.x.length).toBeLessThanOrEqual(640);
    expect(plot.y.length).toBeLessThanOrEqual(640);
    expect(plot.z.length).toBeLessThanOrEqual(640);
    expect(plot.min).toBeCloseTo(-1, 2);
    expect(plot.max).toBe(6);
    expect(plot.lastTs).toBe(4999);
  });

  it("returns an empty plot for an empty ring", () => {
    const plot = decimateMag(new RingBuffer(10), 320);
    expect(plot.x).toEqual([]);
  });
});

describe("CompassStreamCard", () => {
  it("coalesces a burst of samples into at most one render per frame", () => {
    let emit: ((m: MagneticFieldStrength2) => void) | null = null;
    const client = {
      subscribeMag2: (_node: number, cb: (m: MagneticFieldStrength2) => void) => {
        emit = cb;
        return () => {
          emit = null;
        };
      },
    } as unknown as CompassStreamClient;
    const frames: FrameRequestCallback[] = [];
    const raf = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb) => {
        frames.push(cb);
        return frames.length;
      });

    render(<CompassStreamCard client={client} />);
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "5" } });
    fireEvent.click(screen.getByText("button"));
    expect(emit).not.toBeNull();

    act(() => {
      for (let i = 0; i < 5000; i++) {
        emit!({ magneticFieldGa: [i, -i, 0] } as unknown as MagneticFieldStrength2);
      }
    });
    expect(raf).toHaveBeenCalledTimes(1);
    act(() => {
      frames.splice(0).forEach((f) => f(0));
    });
    expect(screen.getByText(/^5000/)).toBeTruthy();
    const lines = screen.getByTestId("compass-plot").querySelectorAll("polyline");
    for (const line of Array.from(lines)) {
      const pts = (line.getAttribute("points") ?? "").split(" ");
      expect(pts.length).toBeLessThanOrEqual(640);
    }
    raf.mockRestore();
  });
});
