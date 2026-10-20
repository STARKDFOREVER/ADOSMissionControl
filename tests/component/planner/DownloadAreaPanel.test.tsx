/**
 * The offline area panel downloads the current view or the plan's own area
 * (waypoints, planned home, fence and rally plus 500 m), with ground elevation
 * alongside the tiles by default. Plan area is unavailable, with the reason,
 * for an empty plan; the tile and elevation progress are counted apart; an
 * area too large for the terrain download says so.
 * @license GPL-3.0-only
 */

import { beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { Waypoint } from "@/lib/types";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const prefetch = vi.hoisted(() => ({
  fn: vi.fn<(bounds: unknown, onProgress?: (d: number, t: number) => void, signal?: AbortSignal) => Promise<{ fetched: number; failed: number }>>(),
}));
vi.mock("@/lib/terrain/terrain-provider", () => ({
  prefetchElevationGrid: (...args: Parameters<typeof prefetch.fn>) => prefetch.fn(...args),
}));
vi.mock("@/lib/tile-storage", () => ({ freeTileStorageBytes: () => Promise.resolve(null) }));
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import { DownloadAreaPanel } from "@/components/planner/DownloadAreaPanel";
import { planAreaBounds } from "@/lib/geo/plan-bounds";
import { useTileDownloadStore } from "@/stores/tile-download-store";
import { useMissionStore } from "@/stores/mission-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";

const VIEW = { north: 13.0, south: 12.9, east: 77.7, west: 77.5 };
const WPS: Waypoint[] = [
  { id: "a", lat: 12.97, lon: 77.59, alt: 30, command: "TAKEOFF" },
  { id: "b", lat: 12.975, lon: 77.6, alt: 50 },
];

const startDownload = vi.fn();
const cancelDownload = vi.fn();

function renderPanel() {
  return renderWithIntl(
    <DownloadAreaPanel bounds={VIEW} currentZoom={14} currentProvider="dark" onClose={() => {}} />,
  );
}

const planRadio = () => screen.getByRole("radio", { name: "Plan area" });

beforeEach(() => {
  cleanup();
  prefetch.fn.mockReset();
  startDownload.mockReset();
  cancelDownload.mockReset();
  useTileDownloadStore.setState({
    isDownloading: false,
    progress: { completed: 0, total: 0, bytes: 0, skipped: 0, failed: 0 },
    result: null,
    error: null,
    startDownload,
    cancelDownload,
  });
  useMissionStore.setState({ waypoints: WPS, plannedHome: null });
  useGeofenceStore.setState({ fenceType: "polygon", circleCenter: null, polygonPoints: [], zones: [] });
  useRallyStore.setState({ points: [] });
});

describe("DownloadAreaPanel area", () => {
  it("Plan area is unavailable for an empty plan, with the reason", () => {
    useMissionStore.setState({ waypoints: [] });
    renderPanel();
    expect(planRadio().getAttribute("aria-disabled")).toBe("true");
    expect(planRadio().getAttribute("title")).toMatch(/^The plan is empty/);
    fireEvent.click(planRadio());
    expect(planRadio().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("radio", { name: "Current view" }).getAttribute("aria-checked")).toBe("true");
  });

  it("downloads tiles and elevation over the plan area plus 500 m", async () => {
    prefetch.fn.mockResolvedValue({ fetched: 10, failed: 0 });
    renderPanel();
    fireEvent.click(planRadio());
    expect(planRadio().getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    const expected = planAreaBounds(WPS, null, useGeofenceStore.getState(), [], 500);
    expect(startDownload.mock.calls[0][0]).toEqual(expected);
    expect(prefetch.fn.mock.calls[0][0]).toEqual(expected);
    expect(screen.getByText("Elevation: 10 tiles stored")).toBeDefined();
  });

  it("the current view is the default area", async () => {
    prefetch.fn.mockResolvedValue({ fetched: 1, failed: 0 });
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    expect(startDownload.mock.calls[0][0]).toEqual(VIEW);
  });

  it("skips elevation when the terrain toggle is off", async () => {
    renderPanel();
    const toggle = screen.getByRole("switch", { name: "Include terrain elevation" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    expect(startDownload).toHaveBeenCalled();
    expect(prefetch.fn).not.toHaveBeenCalled();
  });
});

describe("DownloadAreaPanel progress", () => {
  it("shows tile and elevation progress separately", async () => {
    // Elevation reports 120 of 400 tiles and keeps running; so do the tiles.
    prefetch.fn.mockImplementation((_b, onProgress) => {
      onProgress?.(120, 400);
      return Promise.withResolvers<{ fetched: number; failed: number }>().promise;
    });
    startDownload.mockImplementation(() => {
      useTileDownloadStore.setState({
        isDownloading: true,
        progress: { completed: 5, total: 20, bytes: 2048, skipped: 0, failed: 0 },
      });
      return Promise.withResolvers<void>().promise;
    });
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    expect(screen.getByText("Tiles 5 / 20")).toBeDefined();
    expect(screen.getByText("Elevation tiles 120 / 400")).toBeDefined();

    // Cancel stops both.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelDownload).toHaveBeenCalled();
    expect((prefetch.fn.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
  });

  it("an area too large for the terrain download says so", async () => {
    prefetch.fn.mockRejectedValue(new RangeError("Area too large for terrain download"));
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("Area too large for terrain download");
  });
});
