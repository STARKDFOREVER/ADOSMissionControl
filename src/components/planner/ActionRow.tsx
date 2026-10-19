/**
 * @module ActionRow
 * @description One attached action inside a waypoint's action timeline: a compact
 * row (grip, type icon, label, key-parameter summary) that expands to an inline
 * parameter editor. DO_JUMP gets a target-waypoint picker; every other action
 * reuses the shared per-command parameter editors.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import {
  GripVertical, X, ChevronDown, ChevronRight,
  Camera, Move3d, Crosshair, EyeOff, Gauge, RotateCw, SlidersHorizontal,
  Grab, ArrowDownUp, ToggleRight, CornerUpRight, Timer, Ruler, Shield, Home, Hash,
  type LucideIcon,
} from "lucide-react";
import { Select } from "@/components/ui/select";
import { PropertyRow } from "@/components/ui/property-row";
import { ScrubNumberField } from "@/components/ui/scrub-number-field";
import { cn } from "@/lib/utils";
import type {
  ActionCommand, CommandMissionAction, MissionAction, RawMissionAction,
} from "@/lib/types";
import { POSITION_BEARING_ACTIONS } from "@/lib/mission/command-classes";
import { CommandSpecificEditors } from "./WaypointCommandEditors";

/** Lucide icon per action command. */
const ACTION_ICON: Record<ActionCommand, LucideIcon> = {
  DO_SET_CAM_TRIGG: Camera,
  DO_DIGICAM: Camera,
  DO_MOUNT_CONTROL: Move3d,
  ROI: Crosshair,
  DO_SET_ROI_NONE: EyeOff,
  DO_SET_SPEED: Gauge,
  CONDITION_YAW: RotateCw,
  DO_SET_SERVO: SlidersHorizontal,
  DO_GRIPPER: Grab,
  DO_WINCH: ArrowDownUp,
  DO_AUX_FUNCTION: ToggleRight,
  DO_JUMP: CornerUpRight,
  DELAY: Timer,
  CONDITION_DISTANCE: Ruler,
  DO_FENCE_ENABLE: Shield,
  DO_SET_HOME: Home,
};

/** One selectable jump target: a navigation waypoint's id + its 1-based label. */
export interface NavTarget {
  id: string;
  label: string;
}

/**
 * A short, mostly unit-based summary of an action's key parameters, shown on the
 * compact row (e.g. "5 m/s", "90°", "→ WP2 ×3"). Returns "" when there is nothing
 * meaningful to summarize.
 */
function summarize(action: CommandMissionAction, targets: NavTarget[]): string {
  const p1 = action.param1;
  const p2 = action.param2;
  switch (action.command) {
    case "DO_SET_SPEED": return p2 !== undefined ? `${p2} m/s` : "";
    case "DO_SET_CAM_TRIGG": return p1 ? `every ${p1} m` : "";
    case "CONDITION_YAW": return p1 !== undefined ? `${p1}°` : "";
    case "DELAY": return p1 !== undefined ? `${p1} s` : "";
    case "CONDITION_DISTANCE": return p1 !== undefined ? `${p1} m` : "";
    case "DO_MOUNT_CONTROL": return p1 !== undefined ? `pitch ${p1}°` : "";
    case "DO_SET_SERVO": return p1 !== undefined && p2 !== undefined ? `#${p1} · ${p2} us` : "";
    case "DO_FENCE_ENABLE": return p1 ? "enable" : "disable";
    case "ROI":
    case "DO_SET_HOME":
      return action.lat !== undefined && action.lon !== undefined && (action.lat !== 0 || action.lon !== 0)
        ? `${action.lat.toFixed(5)}, ${action.lon.toFixed(5)}`
        : "no location";
    case "DO_JUMP": {
      const target = action.jumpTargetId ? targets.find((t) => t.id === action.jumpTargetId) : undefined;
      // The flight controller never takes a jump whose repeat count is 0.
      const repeat = p2 ?? 0;
      const rep = repeat === 0 ? " ×0 (inactive)" : repeat < 0 ? " ×∞" : repeat > 1 ? ` ×${repeat}` : "";
      return target ? `→ ${target.label}${rep}` : "→ ?";
    }
    default: return "";
  }
}

interface ActionRowProps {
  action: MissionAction;
  /** Navigation waypoints a DO_JUMP may target (excludes non-nav rows). */
  targets: NavTarget[];
  expanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (update: Partial<CommandMissionAction>) => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
  dragOver: boolean;
}

/**
 * dataTransfer type that marks a drag as an attached-action drag. The waypoint
 * list ignores drags carrying it, so an action dropped on another waypoint's
 * row never reorders the waypoints.
 */
export const ACTION_DRAG_TYPE = "application/x-ados-mission-action";

/**
 * Drag handlers for an action row nested inside a draggable waypoint row: each
 * event stops at the action so the waypoint list never sees it.
 */
function actionDragHandlers(
  h: Pick<ActionRowProps, "onDragStart" | "onDragOver" | "onDragEnd" | "onDrop">,
) {
  return {
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(ACTION_DRAG_TYPE, "");
      h.onDragStart(e);
    },
    onDragOver: (e: React.DragEvent) => { e.stopPropagation(); h.onDragOver(e); },
    onDragEnd: (e: React.DragEvent) => { e.stopPropagation(); h.onDragEnd(); },
    onDrop: (e: React.DragEvent) => { e.stopPropagation(); h.onDrop(e); },
  };
}

/** One attached action: an editable modelled command or a read-only raw item. */
export function ActionRow(props: ActionRowProps) {
  const { action } = props;
  return action.command === "RAW"
    ? <RawActionRow {...props} action={action} />
    : <CommandActionRow {...props} action={action} />;
}

/**
 * A mission item this GCS does not model, kept verbatim from a download or
 * import. It is shown read-only as its MAV_CMD number and can only be moved or
 * removed, so the upload re-emits exactly what the vehicle or file held.
 */
function RawActionRow({
  action, expanded, onToggleExpand, onRemove,
  onDragStart, onDragOver, onDragEnd, onDrop, dragOver,
}: Omit<ActionRowProps, "action"> & { action: RawMissionAction }) {
  const t = useTranslations("planner");
  const label = `MAV_CMD ${action.rawCommand}`;
  return (
    <div
      draggable
      {...actionDragHandlers({ onDragStart, onDragOver, onDragEnd, onDrop })}
      className={cn(
        "border-t border-border-default",
        dragOver && "border-t-2 border-t-accent-primary",
      )}
    >
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <GripVertical size={11} className="text-text-tertiary shrink-0 cursor-grab" />
        <Hash size={12} className="text-text-tertiary shrink-0" />
        <button
          onClick={onToggleExpand}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left cursor-pointer"
        >
          <span className="text-[11px] font-mono text-text-primary truncate">{label}</span>
          <span className="text-[11px] text-text-tertiary truncate">{t("actions.readOnly")}</span>
        </button>
        <button onClick={onToggleExpand}
          aria-label={t(expanded ? "inspector.waypoint.collapseAction" : "inspector.waypoint.expandAction")}
          aria-expanded={expanded}
          className="text-text-tertiary hover:text-text-primary shrink-0 cursor-pointer">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <button
          onClick={onRemove}
          aria-label={t("actions.remove")}
          className="text-text-tertiary hover:text-status-error transition-colors shrink-0 cursor-pointer"
        >
          <X size={11} />
        </button>
      </div>
      {expanded && (
        <div className="px-2 pb-2 pt-0.5 text-[11px] font-mono text-text-tertiary break-words">
          p1–4: {action.param1}, {action.param2}, {action.param3}, {action.param4} · x/y/z: {action.x}, {action.y}, {action.z} · frame {action.frame}
        </div>
      )}
    </div>
  );
}

function CommandActionRow({
  action, targets, expanded, onToggleExpand, onUpdate, onRemove,
  onDragStart, onDragOver, onDragEnd, onDrop, dragOver,
}: Omit<ActionRowProps, "action"> & { action: CommandMissionAction }) {
  const t = useTranslations("planner");
  const Icon = ACTION_ICON[action.command];
  const label = t(`actions.cmd.${action.command}`);
  const summary = summarize(action, targets);
  return (
    <div
      draggable
      {...actionDragHandlers({ onDragStart, onDragOver, onDragEnd, onDrop })}
      className={cn(
        "border-t border-border-default",
        dragOver && "border-t-2 border-t-accent-primary",
      )}
    >
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <GripVertical size={11} className="text-text-tertiary shrink-0 cursor-grab" />
        <Icon size={12} className="text-text-secondary shrink-0" />
        <button
          onClick={onToggleExpand}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left cursor-pointer"
        >
          <span className="text-[11px] text-text-primary truncate">{label}</span>
          {summary && <span className="text-[11px] font-mono text-text-tertiary truncate">{summary}</span>}
        </button>
        <button onClick={onToggleExpand}
          aria-label={t(expanded ? "inspector.waypoint.collapseAction" : "inspector.waypoint.expandAction")}
          aria-expanded={expanded}
          className="text-text-tertiary hover:text-text-primary shrink-0 cursor-pointer">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <button
          onClick={onRemove}
          aria-label={t("actions.remove")}
          className="text-text-tertiary hover:text-status-error transition-colors shrink-0 cursor-pointer"
        >
          <X size={11} />
        </button>
      </div>

      {expanded && (
        <div className="px-2 pb-2 pt-0.5 flex flex-col">
          {action.command === "DO_JUMP" ? (
            <>
              <PropertyRow label={t("actions.jumpTarget")}>
                <Select ariaLabel={t("actions.jumpTarget")} compact options={targets.map((tg) => ({ value: tg.id, label: tg.label }))}
                value={action.jumpTargetId ?? ""}
                onChange={(v) => onUpdate({ jumpTargetId: v })}
                placeholder={t("actions.jumpTargetPlaceholder")} />
              </PropertyRow>
              <PropertyRow label={t("repeat")}>
                <ScrubNumberField value={action.param2} step={1} precision={0} placeholder="0" ariaLabel={t("repeat")}
                  onCommit={(n) => onUpdate({ param2: n })} onClear={() => onUpdate({ param2: undefined })} />
              </PropertyRow>
              {!action.jumpTargetId && (
                <span className="py-1 text-[11px] text-status-error">{t("actions.jumpNoTarget")}</span>
              )}
              {(action.param2 ?? 0) < 0 && (
                <span className="py-1 text-[11px] text-status-warning">{t("actions.jumpForever")}</span>
              )}
            </>
          ) : POSITION_BEARING_ACTIONS.has(action.command) ? (
            <PositionEditor action={action} onUpdate={onUpdate} />
          ) : (
            <CommandSpecificEditors cmd={action.command} params={action} onUpdate={onUpdate} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Location of a positioned action (ROI target, new home). Each field commits
 * on blur; an emptied or non-numeric field keeps the previous value.
 */
function PositionEditor({
  action, onUpdate,
}: { action: CommandMissionAction; onUpdate: (update: Partial<CommandMissionAction>) => void }) {
  const t = useTranslations("planner");
  return (
    <div className="flex flex-col">
      <PropertyRow label={t("lat")}>
        <ScrubNumberField value={action.lat} step={0.0001} precision={7} min={-90} max={90}
          ariaLabel={t("lat")} onCommit={(lat) => onUpdate({ lat })} />
      </PropertyRow>
      <PropertyRow label={t("lon")}>
        <ScrubNumberField value={action.lon} step={0.0001} precision={7} min={-180} max={180}
          ariaLabel={t("lon")} onCommit={(lon) => onUpdate({ lon })} />
      </PropertyRow>
      <PropertyRow label={t("altitude")}>
        <ScrubNumberField value={action.alt} step={1} unit="m"
          ariaLabel={t("altitude")} onCommit={(alt) => onUpdate({ alt })} />
      </PropertyRow>
    </div>
  );
}
