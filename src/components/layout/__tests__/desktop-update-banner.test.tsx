/**
 * The desktop update banner: a failed check is quiet information, a failed
 * download offers Retry, and Install is disabled while any vehicle is armed or
 * linked with an unknown arm state.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import { DesktopUpdateBanner } from "../DesktopUpdateBanner";
import { useNodeRegistryStore } from "@/stores/node-registry";
import type { NodeEntry } from "@/stores/node-registry/types";
import type { ElectronUpdateStatus } from "@/types/electron";

const download = vi.fn(() => Promise.resolve());
const install = vi.fn(() => Promise.resolve());

function mountWith(status: ElectronUpdateStatus): void {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      isElectron: true,
      platform: "linux",
      updates: {
        status: () => Promise.resolve(status),
        onStatus: () => () => {},
        download,
        install,
        check: () => Promise.resolve(status),
      },
    },
  });
}

function setFc(fc: Record<string, unknown>): void {
  useNodeRegistryStore.setState({
    nodes: { "node:a": { nodeId: "node:a", fc } as unknown as NodeEntry },
  });
}

async function renderBanner(): Promise<void> {
  render(<DesktopUpdateBanner />);
  // Let the mount-time `status()` read resolve.
  await act(async () => {});
}

beforeEach(() => {
  download.mockClear();
  install.mockClear();
  useNodeRegistryStore.setState({ nodes: {} });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "electronAPI");
});

describe("DesktopUpdateBanner", () => {
  it("shows a failed check as information, not as an alert", async () => {
    mountWith({ state: "check-failed", message: "offline" });
    await renderBanner();
    expect(screen.getByText("checkFailed")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers Retry after a failed download and retries it", async () => {
    mountWith({ state: "error", phase: "download", message: "connection reset" });
    await renderBanner();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByText("retry"));
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("offers no Retry after a failed install", async () => {
    mountWith({ state: "error", phase: "install", message: "boom" });
    await renderBanner();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("retry")).toBeNull();
  });

  it("install_disabled_when_armed", async () => {
    setFc({ managedId: "d1", armState: "armed", status: "in_mission" });
    mountWith({ state: "downloaded", version: "1.2.3" });
    await renderBanner();
    const button = screen.getByText("install").closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("installBlockedArmed");
    fireEvent.click(button);
    expect(install).not.toHaveBeenCalled();
  });

  it("disables Install for a linked vehicle whose arm state is unknown", async () => {
    setFc({ managedId: "d1", armState: "unknown", status: "online" });
    mountWith({ state: "downloaded", version: "1.2.3" });
    await renderBanner();
    const button = screen.getByText("install").closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("enables Install when every linked vehicle is disarmed", async () => {
    setFc({ managedId: "d1", armState: "disarmed", status: "online" });
    mountWith({ state: "downloaded", version: "1.2.3" });
    await renderBanner();
    const button = screen.getByText("install").closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while idle", async () => {
    mountWith({ state: "idle" });
    await renderBanner();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers Download for an installable update", async () => {
    mountWith({ state: "available", version: "1.2.3", installable: true, releasesUrl: "https://example.com/r" });
    await renderBanner();
    expect(screen.getByText("available")).toBeTruthy();
    expect(screen.queryByText("openReleases")).toBeNull();
    fireEvent.click(screen.getByText("download"));
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("links to the releases page when the build cannot install itself", async () => {
    mountWith({ state: "available", version: "1.2.3", installable: false, releasesUrl: "https://example.com/r" });
    await renderBanner();
    expect(screen.getByText("manualOnly", { exact: false })).toBeTruthy();
    const link = screen.getByText("openReleases").closest("a") as HTMLAnchorElement;
    expect(link.href).toBe("https://example.com/r");
    expect(screen.queryByText("download")).toBeNull();
  });

  it("shows download progress without actions", async () => {
    mountWith({ state: "downloading", version: "1.2.3" });
    await renderBanner();
    expect(screen.getByText("downloading")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hides the banner once dismissed", async () => {
    mountWith({ state: "check-failed", message: "offline" });
    await renderBanner();
    fireEvent.click(screen.getByText("dismiss"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
