"use client";

/**
 * @module use-plugin-lifecycle-ui
 * @description Mounts the operator UI the plugin lifecycle client uses:
 * the armed-vehicle confirm dialog (409 `E_ARMED` on install, enable,
 * disable or remove) and a warning toast for a remove that completed with
 * a host warning. The app shell renders {@link PluginLifecycleUiHost} once.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { registerPluginLifecycleUi } from "@/lib/agent/plugin-lifecycle";

/** Mounts the plugin lifecycle UI; rendered once in the root layout. */
export function PluginLifecycleUiHost(): ReactNode {
  const t = useTranslations("armedOverride");
  const { toast } = useToast();
  const [message, setMessage] = useState<string | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(
    () =>
      registerPluginLifecycleUi({
        confirmArmed: (text) =>
          new Promise<boolean>((resolve) => {
            // A second refusal while a prompt is open declines the older one.
            resolverRef.current?.(false);
            resolverRef.current = resolve;
            setMessage(text);
          }),
        warn: (text) => toastRef.current(text, "warning"),
      }),
    [],
  );

  const settle = (confirmed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setMessage(null);
    resolve?.(confirmed);
  };

  return (
    <ConfirmDialog
      open={message !== null}
      title={t("title")}
      message={message ?? ""}
      confirmLabel={t("confirm")}
      variant="danger"
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
}
