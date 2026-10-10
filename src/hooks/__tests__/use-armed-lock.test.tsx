/**
 * The arm lock and the armed parameter-write confirm treat an open link whose
 * arm state is still unknown as possibly armed, and the per-drone lock reads
 * that drone's own registry entry rather than the selected drone.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { confirmArmedParamWrite } from "@/lib/protocol/param-write";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import type { NodeEntry } from "@/stores/node-registry/types";
import { useArmedConfirmStore } from "@/stores/armed-confirm-store";

const MESSAGES = {
  armedLock: {
    soft: "soft-armed",
    softUnknown: "soft-unknown",
    hard: "hard-armed",
    hardUnknown: "hard-unknown",
  },
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(() => {
  useDroneStore.setState({ armState: "unknown", connectionState: "disconnected" });
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  useArmedConfirmStore.getState().cancel();
});

describe("useArmedLock", () => {
  it("hard-blocks an open link whose arm state is unknown, with the unknown message", () => {
    useDroneStore.setState({ armState: "unknown", connectionState: "connected" });
    const { result } = renderHook(() => useArmedLock(), { wrapper });
    expect(result.current.isHardBlocked).toBe(true);
    expect(result.current.isArmed).toBe(false);
    expect(result.current.hardBlockMessage).toBe("hard-unknown");
    expect(result.current.lockMessage).toBe("soft-unknown");
  });

  it("hard-blocks an armed vehicle with the armed message", () => {
    useDroneStore.setState({ armState: "armed", connectionState: "connected" });
    const { result } = renderHook(() => useArmedLock(), { wrapper });
    expect(result.current.isHardBlocked).toBe(true);
    expect(result.current.hardBlockMessage).toBe("hard-armed");
  });

  it("does not block a disarmed or disconnected vehicle", () => {
    useDroneStore.setState({ armState: "disarmed", connectionState: "connected" });
    expect(renderHook(() => useArmedLock(), { wrapper }).result.current.isHardBlocked).toBe(
      false,
    );
    useDroneStore.setState({ armState: "unknown", connectionState: "disconnected" });
    expect(renderHook(() => useArmedLock(), { wrapper }).result.current.isHardBlocked).toBe(
      false,
    );
  });

  it("reads the named drone's registry entry, not the selected drone", () => {
    const NODE = "node:panel-drone";
    useDroneStore.setState({ armState: "disarmed", connectionState: "connected" });
    useDroneManager.setState({
      drones: new Map([
        [NODE, { id: NODE, name: NODE, protocol: { isConnected: true } } as unknown as ManagedDrone],
      ]),
      selectedDroneId: "node:other",
    });
    const spy = vi
      .spyOn(useNodeRegistryStore.getState(), "getEntry")
      .mockImplementation((id: string) =>
        id === NODE
          ? ({ fc: { managedId: NODE, armState: "armed" } } as unknown as NodeEntry)
          : undefined,
      );
    const { result } = renderHook(() => useArmedLock(NODE), { wrapper });
    expect(result.current.isHardBlocked).toBe(true);
    expect(result.current.isArmed).toBe(true);
    spy.mockRestore();
  });
});

describe("confirmArmedParamWrite", () => {
  it("asks on an open link whose arm state is unknown", async () => {
    useDroneStore.setState({ armState: "unknown", connectionState: "connected" });
    const pending = confirmArmedParamWrite("panel", ["FRAME_CLASS"]);
    expect(useArmedConfirmStore.getState().open).toBe(true);
    expect(useArmedConfirmStore.getState().context?.armStateUnknown).toBe(true);
    useArmedConfirmStore.getState().confirm();
    await expect(pending).resolves.toBe(true);
  });

  it("asks an armed vehicle without the unknown flag", async () => {
    useDroneStore.setState({ armState: "armed", connectionState: "connected" });
    const pending = confirmArmedParamWrite("panel", ["FRAME_CLASS"]);
    expect(useArmedConfirmStore.getState().context?.armStateUnknown).toBe(false);
    useArmedConfirmStore.getState().cancel();
    await expect(pending).resolves.toBe(false);
  });

  it("does not ask a disarmed vehicle", async () => {
    useDroneStore.setState({ armState: "disarmed", connectionState: "connected" });
    await expect(confirmArmedParamWrite("panel", ["FRAME_CLASS"])).resolves.toBe(true);
    expect(useArmedConfirmStore.getState().open).toBe(false);
  });
});
