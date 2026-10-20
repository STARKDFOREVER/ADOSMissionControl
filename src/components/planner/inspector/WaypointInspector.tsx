/**
 * @module WaypointInspector
 * @description Inspector body for one selected waypoint: position, altitude,
 * speed, command and its per-command parameters, and the attached action
 * timeline. Every field commits through the planner's `updateWaypoint`.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { MoreHorizontal, RotateCcw } from "lucide-react";
import { ScrubNumberField } from "@/components/ui/scrub-number-field";
import { PropertyRow } from "@/components/ui/property-row";
import { PropertySection } from "@/components/ui/property-section";
import { Select } from "@/components/ui/select";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { useSupportedMissionCommands } from "@/hooks/use-supported-mission-commands";
import { usePlanVehicleProfile } from "@/hooks/use-plan-profile";
import { usePlannerStore } from "@/stores/planner-store";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { cmdMap } from "@/lib/mission/command-map";
import { px4AcceptedActions } from "@/lib/protocol/firmware/px4";
import { setClipboard } from "@/lib/waypoint-clipboard";
import type { ActionCommand, NavCommand, Waypoint } from "@/lib/types";
import {
  NAV_COMMAND_OPTIONS, INAV_ACTION_OPTIONS, INAV_ACTION_LABEL, INAV_ACTION_COMMANDS, commandChangeUpdate,
} from "../waypoint-constants";
import { CommandSpecificEditors, INavCommandEditors } from "../WaypointCommandEditors";
import { WaypointActionTimeline } from "../WaypointActionTimeline";
import type { Planner } from "@/app/plan/use-planner";

interface WaypointInspectorProps {
  p: Planner;
  waypoint: Waypoint;
}

/** The PX4 action list in picker order. */
const PX4_ACTIONS: readonly ActionCommand[] = [...px4AcceptedActions];

export function WaypointInspector({ p, waypoint }: WaypointInspectorProps) {
  const t = useTranslations("planner.inspector.waypoint");
  const wpId = waypoint.id;
  const { updateWaypoint } = p;
  const onUpdate = useCallback(
    (update: Partial<Waypoint>) => updateWaypoint(wpId, update),
    [updateWaypoint, wpId],
  );
  const defaultSpeed = usePlannerStore((s) => s.defaultSpeed);
  const defaultAcceptRadius = usePlannerStore((s) => s.defaultAcceptRadius);
  const cmd = waypoint.command ?? "WAYPOINT";

  // Hide nav commands the connected firmware would reject; the current command
  // always stays so an already-set waypoint still displays it.
  const supportedCmds = useSupportedMissionCommands();
  const navOptions = useMemo(() => {
    if (!supportedCmds) return NAV_COMMAND_OPTIONS;
    return NAV_COMMAND_OPTIONS.filter((o) => o.value === cmd || supportedCmds.has(cmdMap[o.value]));
  }, [supportedCmds, cmd]);

  const protocol = useDroneManager(selectSelectedProtocol);
  const isInav = protocol?.getVehicleInfo()?.firmwareType === "inav";
  const profile = usePlanVehicleProfile();
  // The action picker offers only what the target autopilot flies.
  const allowedActions = isInav ? INAV_ACTION_COMMANDS : profile.autopilot === "px4" ? PX4_ACTIONS : undefined;
  const inavOptions = INAV_ACTION_LABEL[cmd]
    ? INAV_ACTION_OPTIONS
    : [...INAV_ACTION_OPTIONS, { value: cmd as NavCommand, label: cmd }];

  // A new command starts from clean slots plus its own defaults: a stale slot
  // means something else under the new command (a hold time turns a WAYPOINT
  // into a timed hold; an acceptance radius becomes LAND's precision mode).
  const changeCommand = useCallback(
    (v: string) => onUpdate(commandChangeUpdate(v as NavCommand, defaultAcceptRadius)),
    [onUpdate, defaultAcceptRadius],
  );
  const setHoldTime = useCallback((holdTime: number | undefined) => onUpdate({ holdTime }), [onUpdate]);

  return (
    <>
      <PropertySection title={t("position")}>
        <PropertyRow label={t("lat")}>
          <ScrubNumberField value={waypoint.lat} step={0.0001} precision={7} min={-90} max={90}
            ariaLabel={t("lat")} onCommit={(n) => onUpdate({ lat: n })} />
        </PropertyRow>
        <PropertyRow label={t("lon")}>
          <ScrubNumberField value={waypoint.lon} step={0.0001} precision={7} min={-180} max={180}
            ariaLabel={t("lon")} onCommit={(n) => onUpdate({ lon: n })} />
        </PropertyRow>
        <PropertyRow label={t("altitude")}>
          <ScrubNumberField value={waypoint.alt} step={1} unit="m"
            ariaLabel={t("altitude")} onCommit={(n) => onUpdate({ alt: n })} />
        </PropertyRow>
        <PropertyRow
          label={t("speed")}
          trailing={waypoint.speed !== undefined ? (
            <button type="button" onClick={() => onUpdate({ speed: undefined })}
              title={t("useDefaultSpeed")} aria-label={t("useDefaultSpeed")}
              className="p-1 text-text-tertiary hover:text-text-primary cursor-pointer focus-ring rounded-sm">
              <RotateCcw size={12} />
            </button>
          ) : undefined}
        >
          <ScrubNumberField value={waypoint.speed} step={0.5} min={0} unit="m/s"
            placeholder={t("defaultSpeed", { speed: defaultSpeed })}
            ariaLabel={t("speed")} onCommit={(n) => onUpdate({ speed: n })}
            onClear={() => onUpdate({ speed: undefined })} />
        </PropertyRow>
      </PropertySection>

      <PropertySection title={t("behaviour")}>
        {isInav ? (
          <>
            <PropertyRow label={t("action")}>
              <Select options={inavOptions} value={cmd} ariaLabel={t("action")} compact onChange={changeCommand} />
            </PropertyRow>
            <INavCommandEditors cmd={cmd} params={waypoint} onUpdate={onUpdate} onHoldTime={setHoldTime} />
          </>
        ) : (
          <>
            <PropertyRow label={t("command")}>
              <Select options={navOptions} value={cmd} searchable ariaLabel={t("command")} compact onChange={changeCommand} />
            </PropertyRow>
            <CommandSpecificEditors cmd={cmd} params={waypoint} onUpdate={onUpdate} onHoldTime={setHoldTime} />
          </>
        )}
      </PropertySection>

      <PropertySection title={t("actions")}>
        <WaypointActionTimeline waypoint={waypoint} onUpdate={onUpdate} allowedCommands={allowedActions} />
      </PropertySection>
    </>
  );
}

/** Header menu for the selected waypoint: insert around it, copy, delete. */
export function WaypointMenu({ p, waypoint }: WaypointInspectorProps) {
  const t = useTranslations("planner.inspector.waypoint");
  const items = [
    { id: "insert-before", label: t("insertBefore") },
    { id: "insert-after", label: t("insertAfter") },
    { id: "copy", label: t("copy") },
    { id: "div", label: "", divider: true },
    { id: "delete", label: t("delete"), danger: true },
  ];
  const onSelect = (id: string) => {
    switch (id) {
      case "insert-before": p.handleInsertRelative(waypoint.id, "before"); break;
      case "insert-after": p.handleInsertRelative(waypoint.id, "after"); break;
      case "copy": setClipboard([waypoint]); break;
      case "delete": p.removeWaypoint(waypoint.id); break;
    }
  };
  return (
    <DropdownMenu
      align="right"
      items={items}
      onSelect={onSelect}
      trigger={
        <button type="button" aria-label={t("menu")} title={t("menu")}
          className="p-1 rounded-sm text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary cursor-pointer focus-ring">
          <MoreHorizontal size={14} />
        </button>
      }
    />
  );
}
