/**
 * @license GPL-3.0-only
 *
 * The Links panel lists every link a drone holds, marks the primary, and its
 * remove button detaches that link through the drone manager.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) =>
    v ? `${k}:${Object.values(v).join(",")}` : k,
}));

import { DroneLinksPanel } from "../DroneLinksPanel";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import type { DroneProtocol, LinkInfo } from "@/lib/protocol/types";

const now = Date.now();
const LINKS: LinkInfo[] = [
  { id: "l1", type: "webserial", label: "USB", isConnected: true, connectedAt: now, lastByteAt: now, isPrimary: true },
  { id: "l2", type: "websocket", label: "Wi-Fi", isConnected: true, connectedAt: now, lastByteAt: 0, isPrimary: false },
];

const detach = vi.fn(async () => {});

beforeEach(() => {
  detach.mockClear();
  const drone = { id: "fc:a", protocol: { linkInfo: LINKS } as unknown as DroneProtocol } as ManagedDrone;
  useDroneManager.setState({ drones: new Map([["fc:a", drone]]), detachLinkFromDrone: detach });
});

describe("DroneLinksPanel", () => {
  it("lists both links with the primary badge", () => {
    render(<DroneLinksPanel droneId="fc:a" />);
    expect(screen.getByText("USB")).toBeTruthy();
    expect(screen.getByText("Wi-Fi")).toBeTruthy();
    expect(screen.getAllByText("primary")).toHaveLength(1);
    expect(screen.getByText("noData")).toBeTruthy();
  });

  it("removes a link through detachLinkFromDrone", () => {
    render(<DroneLinksPanel droneId="fc:a" />);
    fireEvent.click(screen.getByRole("button", { name: "remove:Wi-Fi" }));
    expect(detach).toHaveBeenCalledWith("fc:a", "l2");
  });

  it("renders nothing for a drone without links", () => {
    const { container } = render(<DroneLinksPanel droneId="fc:missing" />);
    expect(container.firstChild).toBeNull();
  });
});
