import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const requestBuild = vi.fn();
const pollBuildStatus = vi.fn();
vi.mock("../firmware-state/manifests", () => ({
  bfManifest: {
    requestBuild: (...a: unknown[]) => requestBuild(...a),
    pollBuildStatus: (...a: unknown[]) => pollBuildStatus(...a),
    getTargets: vi.fn(async () => []),
    getReleases: vi.fn(async () => []),
    getBuildOptions: vi.fn(async () => null),
    clearCache: vi.fn(),
  },
}));

import { useBetaflightFirmware } from "../firmware-state/use-betaflight-firmware";

async function startBuild() {
  const hook = renderHook(() => useBetaflightFirmware("ardupilot", vi.fn()));
  act(() => {
    hook.result.current.setSelectedBfTarget("STM32F405");
    hook.result.current.setSelectedBfRelease("4.5.0");
  });
  await act(async () => {
    await hook.result.current.handleBfCloudBuild();
  });
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  requestBuild.mockReset().mockResolvedValue({ key: "k1", status: "queued" });
  pollBuildStatus.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useBetaflightFirmware build polling", () => {
  it("keeps polling after a transient poll failure and shows retrying", async () => {
    pollBuildStatus
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ key: "k1", status: "success", url: "u" });
    const hook = await startBuild();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(hook.result.current.bfBuildRetrying).toBe(true);
    expect(hook.result.current.bfBuildPolling).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(pollBuildStatus).toHaveBeenCalledTimes(2);
    expect(hook.result.current.bfBuildRetrying).toBe(false);
    expect(hook.result.current.bfBuildPolling).toBe(false);
    expect(hook.result.current.bfBuildStatus?.status).toBe("success");
  });

  it("schedules no further timers after unmount mid-poll", async () => {
    const { promise, resolve: resolvePoll } = Promise.withResolvers<unknown>();
    pollBuildStatus.mockReturnValue(promise);
    const hook = await startBuild();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(pollBuildStatus).toHaveBeenCalledTimes(1);
    hook.unmount();
    await act(async () => {
      resolvePoll({ key: "k1", status: "processing" });
      await Promise.resolve();
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a timeout (not a build error) and resumes on check again", async () => {
    pollBuildStatus.mockResolvedValue({ key: "k1", status: "processing" });
    const hook = await startBuild();
    for (let i = 0; i < 61; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
    }
    expect(hook.result.current.bfBuildTimedOut).toBe(true);
    expect(hook.result.current.bfBuildStatus?.status).toBe("processing");
    expect(hook.result.current.bfBuildPolling).toBe(false);

    act(() => hook.result.current.checkBfBuildAgain());
    expect(hook.result.current.bfBuildTimedOut).toBe(false);
    expect(hook.result.current.bfBuildPolling).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
  });
});
