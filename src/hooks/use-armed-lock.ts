import { useTranslations } from "next-intl";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import type { ArmState } from "@/lib/types";

interface ArmedLockResult {
  /** Whether the vehicle is positively known to be armed. */
  isArmed: boolean;
  /**
   * Hard gate. True while connected unless the vehicle is positively known to
   * be disarmed: an armed vehicle, and an open link whose arm state has not
   * been read yet, both block. Use this to disable the narrow set of controls
   * that are genuinely unsafe in flight: motor test, servo test, ESC
   * calibration, sensor calibration triggers, frame class changes, reboot.
   * Everything else is writable with a confirmation dialog.
   */
  isHardBlocked: boolean;
  /** Message for banners / tooltips when the vehicle may be armed. */
  lockMessage: string;
  /** Dedicated message for hard-blocked controls. */
  hardBlockMessage: string;
}

/**
 * The arm lock for a vehicle. With no `droneId` it reads the selected
 * vehicle's live store; with a `droneId` it reads that node's own registry
 * entry and managed connection, so a panel for one drone never gates on
 * whichever drone happens to be selected.
 */
export function useArmedLock(droneId?: string): ArmedLockResult {
  const t = useTranslations("armedLock");
  const selectedArm = useDroneStore((s) => s.armState);
  const selectedConnected = useDroneStore((s) => s.connectionState !== "disconnected");
  const nodeArm = useNodeRegistryStore((s) =>
    droneId ? s.getEntry(droneId)?.fc.armState : undefined,
  );
  const nodeConnected = useDroneManager((s) =>
    droneId ? s.drones.get(droneId)?.protocol.isConnected === true : false,
  );

  const armState: ArmState = droneId ? (nodeArm ?? "unknown") : selectedArm;
  const isConnected = droneId ? nodeConnected : selectedConnected;

  const isArmed = armState === "armed";
  const mayBeArmed = isConnected && armState !== "disarmed";
  const unknown = mayBeArmed && !isArmed;

  return {
    isArmed,
    isHardBlocked: mayBeArmed,
    lockMessage: mayBeArmed ? t(unknown ? "softUnknown" : "soft") : "",
    hardBlockMessage: mayBeArmed ? t(unknown ? "hardUnknown" : "hard") : "",
  };
}
