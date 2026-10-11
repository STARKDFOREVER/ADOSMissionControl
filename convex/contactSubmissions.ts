import { query, mutation, type MutationCtx } from "./_generated/server";
import { v, type Infer } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import {
  CONTACT_GLOBAL_POLICY,
  CONTACT_POLICY,
  chargeAttempt,
  rateLimitedResult,
  sha256Hex,
} from "./lib/rateLimit";

/**
 * Field caps. `submit` is fully anonymous and every accepted call both writes a
 * row and schedules an outbound Discord webhook, so an unbounded `v.string()`
 * was an anonymous write of arbitrary size with an amplification attached.
 * Generous against a real enquiry, finite against a script.
 */
export const MAX_SHORT_FIELD = 200;
const MAX_MESSAGE = 5000;

function boundedField(value: string, name: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${name} too long`);
  return trimmed;
}

export function boundedOptional(
  value: string | undefined,
  name: string,
  max: number,
): string | undefined {
  if (value === undefined) return undefined;
  return boundedField(value, name, max) || undefined;
}

/** The fields every contact-style submission carries. */
export const contactArgs = {
  name: v.string(),
  email: v.string(),
  subject: v.optional(v.string()),
  message: v.string(),
  source: v.optional(v.string()),
  company: v.optional(v.string()),
  linkedin: v.optional(v.string()),
};

const contactArgsValidator = v.object(contactArgs);

/**
 * Bound the fields and charge the rate limiter for one anonymous submission.
 * Returns the bounded fields to store, or the rate-limited result to return.
 */
export async function admitContact(
  ctx: MutationCtx,
  args: Infer<typeof contactArgsValidator>,
) {
  const name = boundedField(args.name, "name", MAX_SHORT_FIELD);
  const email = boundedField(args.email, "email", MAX_SHORT_FIELD);
  const message = boundedField(args.message, "message", MAX_MESSAGE);
  if (!name || !email || !message) {
    throw new Error("name, email and message required");
  }

  // Bucketed by the submitted address, hashed so the limiter table is not a
  // second copy of the contact list, plus a global backstop for an address
  // that changes every call. Consumed before the insert, so a burst is
  // stopped before it reaches the webhook scheduler.
  const perAddress = await chargeAttempt(
    ctx,
    `contact:${await sha256Hex(email.toLowerCase())}`,
    CONTACT_POLICY,
  );
  if (!perAddress.ok) {
    return { ok: false as const, result: rateLimitedResult(perAddress.retryAfterMs) };
  }
  const global = await chargeAttempt(ctx, "contact:global", CONTACT_GLOBAL_POLICY);
  if (!global.ok) return { ok: false as const, result: rateLimitedResult(global.retryAfterMs) };

  return {
    ok: true as const,
    bounded: {
      name,
      email,
      message,
      subject: boundedOptional(args.subject, "subject", MAX_SHORT_FIELD),
      source: boundedOptional(args.source, "source", MAX_SHORT_FIELD),
      company: boundedOptional(args.company, "company", MAX_SHORT_FIELD),
      linkedin: boundedOptional(args.linkedin, "linkedin", MAX_SHORT_FIELD),
    },
  };
}

export const submit = mutation({
  args: contactArgs,
  handler: async (ctx, args) => {
    const admitted = await admitContact(ctx, args);
    if (!admitted.ok) return admitted.result;

    await ctx.db.insert("contactSubmissions", admitted.bounded);
    await ctx.scheduler.runAfter(
      0,
      internal.discordNotify.sendContactSubmission,
      admitted.bounded,
    );
    return { error: null };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!profile || profile.role !== "admin") {
      throw new Error("Admin access required");
    }

    return await ctx.db.query("contactSubmissions").order("desc").collect();
  },
});
