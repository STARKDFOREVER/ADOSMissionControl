/**
 * @module WaypointCommandEditors
 * @description Command-specific parameter rows for a waypoint (in the
 * inspector) and for an attached action (in the action timeline). Every field
 * commits to the model slot the MAVLink / iNav translators read; an emptied
 * field clears the slot, so the flight controller's default applies.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { PropertyRow } from "@/components/ui/property-row";
import { ScrubNumberField } from "@/components/ui/scrub-number-field";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SPEED_TYPE_AIRSPEED, SPEED_TYPE_GROUND } from "./waypoint-constants";

/** The subset of parameter fields the command editors read directly. Both a
 * navigation `Waypoint` and an attached `MissionAction` satisfy this shape, so
 * the same per-command editors drive waypoint params and action params alike. */
export interface EditableParams {
  param1?: number;
  param2?: number;
  param3?: number;
  param4?: number;
}

type ParamSlot = keyof EditableParams;

interface CmdEditorProps {
  cmd: string;
  params: EditableParams & { holdTime?: number };
  onUpdate: (update: EditableParams) => void;
  /**
   * The navigation hold-time slot (MAVLink param1). Only navigation commands
   * have it, so actions omit this and hold-time rows never render for them.
   */
  onHoldTime?: (value: number | undefined) => void;
}

interface NumberRowProps {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  step?: number;
  unit?: string;
  placeholder?: string;
  min?: number;
}

/** One optional numeric parameter: emptying it clears the slot. */
function ParamNumberRow({ label, value, onChange, step = 1, unit, placeholder, min }: NumberRowProps) {
  return (
    <PropertyRow label={label}>
      <ScrubNumberField value={value} step={step} unit={unit} placeholder={placeholder} min={min}
        ariaLabel={label} onCommit={onChange} onClear={() => onChange(undefined)} />
    </PropertyRow>
  );
}

interface ChoiceRowProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

function ParamChoiceRow({ label, value, options, onChange }: ChoiceRowProps) {
  return (
    <PropertyRow label={label}>
      {options.length <= 4 ? (
        <SegmentedControl size="sm" stretch ariaLabel={label} options={options} value={value} onChange={onChange} />
      ) : (
        <Select ariaLabel={label} compact options={options} value={value} onChange={onChange} />
      )}
    </PropertyRow>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-[11px] text-text-tertiary">{children}</p>;
}

export function CommandSpecificEditors({ cmd, params, onUpdate, onHoldTime }: CmdEditorProps) {
  const t = useTranslations("planner.inspector.waypoint.param");
  const slot = (key: ParamSlot) => (value: number | undefined) => onUpdate({ [key]: value });
  const pick = (key: ParamSlot, fallback: number) => String(params[key] ?? fallback);
  const pickNumber = (key: ParamSlot) => (v: string) => onUpdate({ [key]: Number(v) });

  return (
    <div className="flex flex-col">
      {/* MAVLink param1 is a hold time only for these; LOITER (unlimited) has none. */}
      {onHoldTime && (cmd === "WAYPOINT" || cmd === "LOITER_TIME" || cmd === "SPLINE_WAYPOINT") && (
        <ParamNumberRow label={t("holdTime")} unit="s" placeholder="0" min={0}
          value={params.holdTime} onChange={onHoldTime} />
      )}
      {/* Pass-through waypoints: model param1 is the acceptance radius (wire param2). */}
      {(cmd === "WAYPOINT" || cmd === "SPLINE_WAYPOINT") && (
        <ParamNumberRow label={t("acceptRadius")} unit="m" placeholder={t("fcDefault")} min={0}
          value={params.param1} onChange={slot("param1")} />
      )}
      {/* MAVLink LOITER_TURNS: param1 turns, param3 radius. The nav one-slot
          shift puts holdTime in param1 and model param2 in param3. */}
      {onHoldTime && cmd === "LOITER_TURNS" && (
        <>
          <ParamNumberRow label={t("turns")} placeholder="1" min={0} value={params.holdTime} onChange={onHoldTime} />
          <ParamNumberRow label={t("radius")} unit="m" placeholder="0" value={params.param2} onChange={slot("param2")} />
        </>
      )}
      {cmd === "CONDITION_YAW" && (
        <>
          <ParamNumberRow label={t("angle")} unit="°" placeholder="0" value={params.param1} onChange={slot("param1")} />
          <ParamNumberRow label={t("yawRate")} unit="°/s" placeholder="0" value={params.param2} onChange={slot("param2")} />
        </>
      )}
      {cmd === "DO_SET_CAM_TRIGG" && (
        <ParamNumberRow label={t("triggerDistance")} unit="m" placeholder="0" min={0}
          value={params.param1} onChange={slot("param1")} />
      )}
      {cmd === "DO_SET_SERVO" && (
        <>
          <ParamNumberRow label={t("servo")} placeholder="5" min={0} value={params.param1} onChange={slot("param1")} />
          <ParamNumberRow label={t("pwm")} unit="µs" step={10} placeholder="1500" value={params.param2} onChange={slot("param2")} />
        </>
      )}
      {cmd === "DO_MOUNT_CONTROL" && (
        <>
          <ParamNumberRow label={t("pitch")} unit="°" placeholder="0" value={params.param1} onChange={slot("param1")} />
          <ParamNumberRow label={t("roll")} unit="°" placeholder="0" value={params.param2} onChange={slot("param2")} />
          <ParamNumberRow label={t("yaw")} unit="°" placeholder="0" value={params.param3} onChange={slot("param3")} />
        </>
      )}
      {cmd === "DO_GRIPPER" && (
        <>
          <ParamNumberRow label={t("gripper")} placeholder="1" min={0} value={params.param1} onChange={slot("param1")} />
          <ParamChoiceRow label={t("gripperAction")} value={pick("param2", 0)} onChange={pickNumber("param2")}
            options={[{ value: "0", label: t("release") }, { value: "1", label: t("grab") }]} />
        </>
      )}
      {/* MAVLink DO_WINCH: param1 instance, param2 action, param3 length, param4 rate. */}
      {cmd === "DO_WINCH" && (
        <>
          <ParamNumberRow label={t("winch")} placeholder="1" min={0} value={params.param1} onChange={slot("param1")} />
          <ParamChoiceRow label={t("winchAction")} value={pick("param2", 0)} onChange={pickNumber("param2")}
            options={[
              { value: "0", label: t("winchRelax") },
              { value: "1", label: t("winchLength") },
              { value: "2", label: t("winchRate") },
            ]} />
          <ParamNumberRow label={t("length")} unit="m" placeholder="0" value={params.param3} onChange={slot("param3")} />
          <ParamNumberRow label={t("winchSpeed")} unit="m/s" step={0.1} placeholder="0" value={params.param4} onChange={slot("param4")} />
        </>
      )}
      {cmd === "DO_FENCE_ENABLE" && (
        <ParamChoiceRow label={t("fence")} value={pick("param1", 0)} onChange={pickNumber("param1")}
          options={[{ value: "0", label: t("disable") }, { value: "1", label: t("enable") }]} />
      )}
      {/* MAVLink PAYLOAD_PLACE param1 (max descent) is the nav holdTime slot. */}
      {onHoldTime && cmd === "NAV_PAYLOAD_PLACE" && (
        <ParamNumberRow label={t("maxDescent")} unit="m" placeholder="10" min={0} value={params.holdTime} onChange={onHoldTime} />
      )}
      {cmd === "CONDITION_DISTANCE" && (
        <ParamNumberRow label={t("distance")} unit="m" placeholder="0" min={0} value={params.param1} onChange={slot("param1")} />
      )}
      {cmd === "DO_AUX_FUNCTION" && (
        <>
          <ParamNumberRow label={t("function")} placeholder="0" min={0} value={params.param1} onChange={slot("param1")} />
          <ParamChoiceRow label={t("switch")} value={pick("param2", 0)} onChange={pickNumber("param2")}
            options={[{ value: "0", label: t("low") }, { value: "1", label: t("mid") }, { value: "2", label: t("high") }]} />
        </>
      )}
      {cmd === "DELAY" && (
        <ParamNumberRow label={t("delay")} unit="s" placeholder="0" min={0} value={params.param1} onChange={slot("param1")} />
      )}
      {cmd === "DO_SET_SPEED" && (
        <>
          <ParamChoiceRow label={t("speedType")} value={pick("param1", SPEED_TYPE_AIRSPEED)} onChange={pickNumber("param1")}
            options={[
              { value: String(SPEED_TYPE_AIRSPEED), label: t("airspeed") },
              { value: String(SPEED_TYPE_GROUND), label: t("groundSpeed") },
            ]} />
          <ParamNumberRow label={t("speed")} unit="m/s" step={0.5} placeholder="5" min={0} value={params.param2} onChange={slot("param2")} />
        </>
      )}
      {cmd === "DO_LAND_START" && <Hint>{t("landStartHint")}</Hint>}
    </div>
  );
}

// ── iNav navigation-command editors ───────────────────────────

interface INavCommandEditorProps {
  cmd: string;
  params: { param1?: number; holdTime?: number };
  onUpdate: (update: { param1?: number }) => void;
  onHoldTime: (value: number | undefined) => void;
}

/**
 * Editors for the navigation commands an iNav waypoint maps onto. Each field
 * writes the model slot the iNav translator reads: POSHOLD_TIME hold time is
 * `holdTime` (MAVLink param1 → iNav p1) and the LAND site elevation is `param1`
 * (MAVLink param2 → iNav p2). The altitude datum (iNav p3 bit 0) follows the
 * waypoint's altitude frame. SET_POI, JUMP and SET_HEAD are attached actions
 * (ROI, DO_JUMP, CONDITION_YAW) in the action timeline.
 */
export function INavCommandEditors({ cmd, params, onUpdate, onHoldTime }: INavCommandEditorProps) {
  const t = useTranslations("planner.inspector.waypoint.param");
  return (
    <div className="flex flex-col">
      {cmd === "LOITER_TIME" && (
        <>
          <ParamNumberRow label={t("holdTime")} unit="s" placeholder="0" min={0}
            value={params.holdTime} onChange={onHoldTime} />
          <Hint>{t("inavHoldHint")}</Hint>
        </>
      )}
      {cmd === "WAYPOINT" && <Hint>{t("inavWaypointHint")}</Hint>}
      {cmd === "LOITER" && <Hint>{t("inavLoiterHint")}</Hint>}
      {cmd === "RTL" && <Hint>{t("inavRtlHint")}</Hint>}
      {cmd === "LAND" && (
        <>
          <ParamNumberRow label={t("elevation")} unit="m" placeholder={t("elevationAuto")}
            value={params.param1} onChange={(v) => onUpdate({ param1: v })} />
          <Hint>{t("inavLandHint")}</Hint>
        </>
      )}
    </div>
  );
}
