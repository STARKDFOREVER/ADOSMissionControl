/**
 * The binding resolver (an arm binding disarms an armed vehicle, a pause
 * binding resumes a paused mission) and the dispatcher's confirm contract
 * (the sheet names the drone, and the vehicle is re-read after approval).
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activate,
  activateBound,
  buildSkillContext,
  registerBuiltins,
  resolveBoundSkillId,
  type ConfirmPolicy,
  type SkillContext,
} from "@/lib/skills";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import type { ProtocolCapabilities } from "@/lib/protocol/types";

const DRONE = "drone-bound";
const OK = { success: true, resultCode: 0, message: "" };
const arm = vi.fn(async () => OK);
const disarm = vi.fn(async () => OK);
const resumeMission = vi.fn(async () => OK);
const setFlightMode = vi.fn(async () => OK);

function selectDrone(caps: Partial<ProtocolCapabilities> = {}): void {
  const drone = {
    id: DRONE,
    name: "Survey One",
    protocol: {
      isConnected: true,
      getCapabilities: () =>
        ({ supportsAutonomousNav: true, ...caps }) as ProtocolCapabilities,
      getFirmwareHandler: () => null,
      arm,
      disarm,
      resumeMission,
      setFlightMode,
    },
  } as unknown as ManagedDrone;
  useDroneManager.setState({
    drones: new Map([[DRONE, drone]]),
    selectedDroneId: DRONE,
  });
}

function ctxWith(confirm: SkillContext["confirm"], notify = vi.fn()): SkillContext {
  return { ...buildSkillContext(DRONE), confirm, notify };
}

const noCaps = { flightMode: "LOITER", previousMode: "AUTO", supports: () => false } as const;

describe("resolveBoundSkillId", () => {
  it("flips arm to disarm only while armed", () => {
    expect(resolveBoundSkillId("arm", "armed", noCaps)).toBe("disarm");
    expect(resolveBoundSkillId("arm", "disarmed", noCaps)).toBe("arm");
    expect(resolveBoundSkillId("arm", "unknown", noCaps)).toBe("arm");
  });

  it("flips pause to resume only for a paused mission on mission-capable firmware", () => {
    const capable = { ...noCaps, supports: () => true };
    expect(resolveBoundSkillId("pause", "armed", capable)).toBe("resume");
    expect(resolveBoundSkillId("pause", "armed", noCaps)).toBe("pause");
    expect(
      resolveBoundSkillId("pause", "armed", { ...capable, previousMode: "GUIDED" }),
    ).toBe("pause");
    expect(resolveBoundSkillId("pause", "armed", { ...capable, flightMode: "AUTO" })).toBe(
      "pause",
    );
    expect(resolveBoundSkillId("rth", "armed", capable)).toBe("rth");
  });
});

describe("bound dispatch", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    for (const fn of [arm, disarm, resumeMission, setFlightMode]) fn.mockClear();
    registerBuiltins();
  });

  afterEach(() => {
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
    vi.useRealTimers();
  });

  it("an arm binding disarms an armed vehicle through the disarm hold confirm", async () => {
    selectDrone();
    useDroneStore.setState({ armState: "armed", lastHeartbeat: Date.now() });
    const policies: ConfirmPolicy[] = [];
    const notify = vi.fn();
    await activateBound(
      "arm",
      ctxWith(async (p) => {
        policies.push(p);
        return true;
      }, notify),
    );
    expect(policies[0].title).toBe("skills.disarm.confirm.title");
    expect(policies[0].gesture).toBe("hold");
    expect(disarm).toHaveBeenCalledTimes(1);
    expect(arm).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith("skills.reason.alreadyArmed", "warning");
  });

  it("a pause binding resumes a paused mission", async () => {
    selectDrone({ supportsMissionUpload: true });
    useDroneStore.setState({
      armState: "armed",
      flightMode: "LOITER",
      previousMode: "AUTO",
      lastHeartbeat: Date.now() + 1,
    });
    await activateBound("pause", ctxWith(async () => true));
    expect(resumeMission).toHaveBeenCalledTimes(1);
    expect(setFlightMode).not.toHaveBeenCalledWith("LOITER");
  });

  it("names the target drone in the confirm values", async () => {
    selectDrone();
    useDroneStore.setState({ armState: "disarmed", lastHeartbeat: Date.now() + 2 });
    const policies: ConfirmPolicy[] = [];
    await activate(
      "arm",
      ctxWith(async (p) => {
        policies.push(p);
        return false;
      }),
    );
    expect(policies[0].values?.drone).toBe("Survey One");
  });

  it("cancels the send when the arm state changed under the open sheet", async () => {
    selectDrone();
    vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
    useDroneStore.setState({ armState: "disarmed", lastHeartbeat: Date.now() });
    const notify = vi.fn();
    await activate(
      "arm",
      ctxWith(async () => {
        // Another station armed the vehicle while the slide was in progress.
        useDroneStore.setState({ armState: "armed" });
        return true;
      }, notify),
    );
    expect(arm).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("skills.reason.changedSincePrompt", "warning");
  });
});
