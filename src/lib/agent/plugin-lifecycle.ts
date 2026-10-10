/**
 * @module PluginLifecycle
 * @description Armed-vehicle handling for the agent's plugin lifecycle
 * calls (install, enable, disable, remove). The agent refuses these with
 * 409 `E_ARMED` while the vehicle is armed; the client asks the operator
 * through the mounted lifecycle UI and resends with the override. A remove
 * that completed with a host warning is surfaced through the same UI.
 *
 * The UI (confirm dialog + toast) is registered by a mounted component;
 * the most recently mounted registration wins. With none mounted, the
 * refusal propagates to the caller unchanged.
 *
 * @license GPL-3.0-only
 */

import { AgentArmedRefusal } from "@/lib/agent/agent-client/transport";

export const PLUGIN_ARMED_CONFIRM_MESSAGE =
  "The vehicle is armed. Changing extensions now can stop one that is flying it. Continue?";

export interface PluginLifecycleUi {
  /** Ask the operator to proceed despite the armed refusal. */
  confirmArmed: (message: string) => Promise<boolean>;
  /** Show a non-fatal warning (e.g. a remove that left something behind). */
  warn: (message: string) => void;
}

const registrations: PluginLifecycleUi[] = [];

export function registerPluginLifecycleUi(ui: PluginLifecycleUi): () => void {
  registrations.push(ui);
  return () => {
    const i = registrations.lastIndexOf(ui);
    if (i >= 0) registrations.splice(i, 1);
  };
}

const activeUi = (): PluginLifecycleUi | undefined => registrations[registrations.length - 1];

/**
 * Run `call(false)`; on an armed refusal ask the operator and, when
 * confirmed, run `call(true)`. A declined prompt (or no UI) rethrows.
 */
export async function withPluginArmedRetry<T>(
  call: (force: boolean) => Promise<T>,
  confirm: ((message: string) => Promise<boolean>) | undefined = activeUi()?.confirmArmed,
): Promise<T> {
  try {
    return await call(false);
  } catch (err) {
    if (!(err instanceof AgentArmedRefusal) || !confirm) throw err;
    if (!(await confirm(PLUGIN_ARMED_CONFIRM_MESSAGE))) throw err;
    return call(true);
  }
}

/** Surface a remove warning the agent returned, when a UI is mounted. */
export function reportPluginWarning(warning: string | null | undefined): void {
  if (warning) activeUi()?.warn(warning);
}
