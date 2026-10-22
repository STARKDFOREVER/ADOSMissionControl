/**
 * @module components/mcp/CopyBlock
 * @description A monospace code block with a copy button, shared by the MCP
 * setup surfaces.
 * @license GPL-3.0-only
 */

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A code block with a copy button. */
export function CopyBlock({ text }: { text: string }) {
  const t = useTranslations("mcp");
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the text stays selectable */
    }
  }
  return (
    <div className="flex items-start gap-2">
      <pre className="flex-1 overflow-x-auto rounded-md border border-border-default bg-bg-tertiary p-3 font-mono text-xs text-text-primary">
        {text}
      </pre>
      <Button
        variant="secondary"
        size="sm"
        icon={copied ? <Check size={14} /> : <Copy size={14} />}
        onClick={copy}
      >
        {copied ? t("reveal.copied") : t("reveal.copy")}
      </Button>
    </div>
  );
}
