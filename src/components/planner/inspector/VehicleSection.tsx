/**
 * @module VehicleSection
 * @description The autopilot and vehicle class the plan is written for. When
 * the plan's vehicle is connected and reports a different profile, an amber
 * row names what it reports and offers to adopt it. Hidden for iNav and
 * Betaflight targets, which do not fly MAVLink missions.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { PropertySection } from "@/components/ui/property-section";
import { PropertyRow } from "@/components/ui/property-row";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { useDroneManager } from "@/stores/drone-manager";
import { useMissionStore } from "@/stores/mission-store";
import { usePlanVehicleProfile, useReportedVehicleProfile } from "@/hooks/use-plan-profile";
import { sameProfile } from "@/lib/mission/plan-profile";
import type { PlanAutopilot, PlanVehicleClass } from "@/lib/types";

const VEHICLE_CLASSES: readonly PlanVehicleClass[] = ["copter", "plane", "vtol", "rover"];

interface VehicleSectionProps {
  /** The drone the plan is assigned to; the selected drone stands in when it is not connected. */
  droneId: string | null;
}

export function VehicleSection({ droneId }: VehicleSectionProps) {
  const t = useTranslations("planner.inspector.vehicle");
  const tSend = useTranslations("planner.send");
  // The vehicle the plan targets: the assigned drone when connected, else the
  // selected one (the same resolution the profile hooks use).
  const targetId = useDroneManager((s) =>
    droneId && s.drones.has(droneId) ? droneId : s.selectedDroneId,
  );
  const target = useDroneManager((s) => (targetId ? s.drones.get(targetId) : undefined));
  const firmwareType = target?.protocol.getVehicleInfo()?.firmwareType;
  const profile = usePlanVehicleProfile(droneId);
  const reported = useReportedVehicleProfile(droneId);
  const setVehicleProfile = useMissionStore((s) => s.setVehicleProfile);

  const autopilotOptions = useMemo(() => [
    { value: "ardupilot" as const, label: t("autopilot.ardupilot") },
    { value: "px4" as const, label: t("autopilot.px4") },
  ], [t]);
  const classOptions = useMemo(
    () => VEHICLE_CLASSES.map((c) => ({ value: c, label: t(`class.${c}`) })),
    [t],
  );

  if (firmwareType === "inav" || firmwareType === "betaflight") return null;

  const mismatch = reported !== null && !sameProfile(reported, profile);

  return (
    <PropertySection title={t("title")} collapsible persistKey="vehicle">
      <PropertyRow label={t("autopilotLabel")}>
        <SegmentedControl<PlanAutopilot> value={profile.autopilot} options={autopilotOptions}
          onChange={(autopilot) => setVehicleProfile({ ...profile, autopilot })}
          size="sm" stretch ariaLabel={t("autopilotLabel")} />
      </PropertyRow>
      <PropertyRow label={t("typeLabel")}>
        <Select options={classOptions} value={profile.vehicleClass} ariaLabel={t("typeLabel")} compact
          onChange={(value) => {
            const vehicleClass = VEHICLE_CLASSES.find((c) => c === value);
            if (vehicleClass) setVehicleProfile({ ...profile, vehicleClass });
          }} />
      </PropertyRow>
      {mismatch && reported && (
        <div className="mt-1 flex items-center gap-2 text-[11px] text-status-warning" data-testid="vehicle-profile-mismatch">
          <span className="flex-1">
            {t("reports", {
              drone: target?.name ?? targetId ?? "",
              profile: `${tSend(`autopilot.${reported.autopilot}`)} ${tSend(`vehicleClass.${reported.vehicleClass}`)}`,
            })}
          </span>
          <button type="button" onClick={() => setVehicleProfile(reported)}
            className="shrink-0 underline cursor-pointer hover:text-text-primary focus-ring">
            {t("use")}
          </button>
        </div>
      )}
    </PropertySection>
  );
}
