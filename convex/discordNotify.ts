"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

const FIELD_VALUE_LIMIT = 1024;
const DESCRIPTION_LIMIT = 4000;

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return value.slice(0, limit - 1) + "…";
}

function pushField(
  fields: Array<{ name: string; value: string; inline: boolean }>,
  name: string,
  value: string | undefined,
  inline: boolean,
): void {
  if (!value) return;
  const trimmed = value.trim();
  if (trimmed.length === 0) return;
  fields.push({ name, value: truncate(trimmed, FIELD_VALUE_LIMIT), inline });
}

export interface LeadFields {
  name: string;
  email: string;
  subject?: string;
  message: string;
  source?: string;
  company?: string;
  linkedin?: string;
}

export interface LeadEmbed {
  title: string;
  color: number;
  /** Extra inline fields shown after Company, in order. */
  extraFields?: ReadonlyArray<{ name: string; value: string | undefined }>;
}

/** Post one lead to the `DISCORD_WEBHOOK_URL` webhook, when it is configured. */
export async function notifyLead(args: LeadFields, embed: LeadEmbed): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[discordNotify] DISCORD_WEBHOOK_URL not set; skipping lead notification.");
    return;
  }

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  pushField(fields, "Name", args.name, true);
  pushField(fields, "Email", args.email, true);
  pushField(fields, "Subject", args.subject, true);
  pushField(fields, "Source", args.source, true);
  pushField(fields, "Company", args.company, true);
  for (const extra of embed.extraFields ?? []) {
    pushField(fields, extra.name, extra.value, true);
  }
  pushField(fields, "LinkedIn", args.linkedin, false);

  const description = `**Message**\n${truncate(
    args.message.trim() || "(empty)",
    DESCRIPTION_LIMIT - 13,
  )}`;

  const payload = {
    embeds: [
      {
        title: embed.title,
        color: embed.color,
        fields,
        description,
        timestamp: new Date().toISOString(),
        footer: { text: "altnautica.com" },
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Altnautica-Lead-Notifier",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<unreadable>");
      console.error(`[discordNotify] webhook responded ${res.status}: ${body}`);
    }
  } catch (err) {
    console.error("[discordNotify] webhook POST failed:", err);
  }
}

export const sendContactSubmission = internalAction({
  args: {
    name: v.string(),
    email: v.string(),
    subject: v.optional(v.string()),
    message: v.string(),
    source: v.optional(v.string()),
    company: v.optional(v.string()),
    linkedin: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    await notifyLead(args, { title: "New contact form submission", color: 0x3b82f6 });
  },
});
