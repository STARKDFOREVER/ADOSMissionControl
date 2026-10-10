/**
 * Kill skill — emergency motor cut. One-shot, any arm state. The highest-
 * consequence built-in: the guarded tier — the first activation arms a guard
 * and only a hold inside the guard window fires. No arm requirement (kill
 * must work anytime). A last-resort command: on a stale link it stays
 * fireable and is sent blind, with a stale-link warning.
 *
 * @module skills/builtins/kill
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import {
  builtinConfirm,
  disabledIfNoBlindLink,
  lastResortPath,
  withStaleLinkWarning,
} from "./_shared";

export const killSkill: Skill = {
  id: "kill",
  label: "skills.kill",
  icon: "Skull",
  category: "safety",
  source: "builtin",
  toggle: false,
  armRequirement: "any",
  confirm: builtinConfirm("kill", "guarded", "danger"),
  getState: (ctx) =>
    disabledIfNoBlindLink(ctx) ?? withStaleLinkWarning(ctx, { kind: "idle" }),
  // The vehicle's answer goes back to the dispatcher, which surfaces a
  // refusal and spends nothing on it.
  // `true` is the confirm block above: the dispatcher only reaches activate
  // after the guard was armed and the hold inside its window completed.
  activate: async (ctx) => lastResortPath(ctx)?.killSwitch(true),
};
