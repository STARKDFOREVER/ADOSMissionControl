/**
 * Land skill — commands a landing at the current position. One-shot, armed-
 * only, hold-to-confirm. Requires autonomous nav. A last-resort command: on a
 * stale link it stays fireable and is sent blind, with a stale-link warning.
 *
 * @module skills/builtins/land
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import {
  builtinConfirm,
  disabledIfNoBlindLink,
  lastResortPath,
  withStaleLinkWarning,
  REASON,
} from "./_shared";

export const landSkill: Skill = {
  id: "land",
  label: "skills.land",
  icon: "ArrowDownToLine",
  category: "flight",
  source: "builtin",
  toggle: false,
  armRequirement: "armed",
  requiresAutonomousNav: true,
  confirm: builtinConfirm("land", "hold", "danger"),
  getState: (ctx) => {
    const noLink = disabledIfNoBlindLink(ctx);
    if (noLink) return noLink;
    if (ctx.armState === "disarmed") {
      return { kind: "disabled", reason: REASON.notArmed };
    }
    return withStaleLinkWarning(ctx, { kind: "idle" });
  },
  // The vehicle's answer goes back to the dispatcher, which surfaces a
  // refusal and spends nothing on it.
  activate: async (ctx) => lastResortPath(ctx)?.land(),
};
