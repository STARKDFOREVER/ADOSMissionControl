/**
 * @module components/mcp/McpRuntimeToggle
 * @description The Docker / From source choice for every MCP setup recipe. The
 * choice lives in the MCP tab store and holds for the session.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useMcpTabStore } from "@/stores/mcp-tab-store";
import type { McpRuntime } from "./mcp-shared";

const RUNTIMES: readonly McpRuntime[] = ["docker", "source"];

export function McpRuntimeToggle() {
  const t = useTranslations("mcp");
  const runtime = useMcpTabStore((s) => s.runtime);
  const setRuntime = useMcpTabStore((s) => s.setRuntime);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-text-secondary">{t("runtime.label")}</span>
        {RUNTIMES.map((r) => (
          <Button
            key={r}
            size="sm"
            variant={runtime === r ? "secondary" : "ghost"}
            onClick={() => setRuntime(r)}
          >
            {r === "docker" ? t("runtime.docker") : t("runtime.source")}
          </Button>
        ))}
      </div>
      <p className="text-xs text-text-tertiary">
        {runtime === "docker" ? t("runtime.dockerHint") : t("runtime.sourceHint")}
      </p>
    </div>
  );
}
