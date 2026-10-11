import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Bootstrap-admin policy for the first profile created on an empty table.
 *
 * SECURITY: the original branch was "the first profile in the table becomes
 * admin", with no allowlist at all. On a freshly-deployed or freshly-purged
 * backend — which every deployment is on day one — whoever signed up first
 * self-minted admin, and admin here reads every profile and every contact
 * submission.
 *
 * The allowlist is supplied by the deployment, never compiled in. Set
 * `ADOS_BOOTSTRAP_ADMIN_EMAILS` in the Convex deployment environment to a
 * comma-separated list of mailboxes; the comparison is trimmed and
 * lower-cased. It is read inside the handler, not at module load, so
 * changing the deployment variable takes effect without a redeploy.
 *
 * With no allowlist configured the default is to mint nothing: every signup
 * is created "pending" and stays there. A deployment that cannot name a
 * mailbox up front can instead set `ADOS_ALLOW_FIRST_USER_ADMIN=1`, which
 * grants admin to the first profile on an empty table whatever its email.
 * That is only safe before the deployment is reachable by anyone else, so it
 * is opt-in, and it is ignored whenever the allowlist is non-empty.
 */
const BOOTSTRAP_ADMIN_EMAILS_VAR = "ADOS_BOOTSTRAP_ADMIN_EMAILS";
const FIRST_USER_ADMIN_VAR = "ADOS_ALLOW_FIRST_USER_ADMIN";

function bootstrapAdminEmails(): string[] {
  return (process.env[BOOTSTRAP_ADMIN_EMAILS_VAR] ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** Comparison helper: is `email` on the deployment's bootstrap allowlist? */
function isBootstrapAdminEmail(email: string | undefined | null): boolean {
  const allowlist = bootstrapAdminEmails();
  if (allowlist.length === 0) return false;
  if (!email) return false;
  return allowlist.includes(email.trim().toLowerCase());
}

/**
 * Whether the first profile on an empty table may be minted admin. Guards
 * the only admin-mint path in this module.
 */
function firstProfileMintsAdmin(email: string | undefined | null): boolean {
  if (bootstrapAdminEmails().length > 0) return isBootstrapAdminEmail(email);
  return process.env[FIRST_USER_ADMIN_VAR] === "1";
}

/**
 * Fetch profile by userId using .first() instead of .unique().
 * Resilient to duplicate profiles — always returns the oldest (first-created) one.
 * Includes fallback for legacy compound userId format (userId|sessionId).
 */
export async function getProfileByUserId(
  ctx: QueryCtx | MutationCtx,
  userId: string
) {
  // Direct lookup with stable userId
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (profile) return profile;

  // Fallback: find a legacy profile with the compound format (userId|sessionId).
  // An INDEXED PREFIX RANGE, not a full-table `.collect()` + `.find()`: this
  // path runs on `getMyProfile`, which is called on every page load and returns
  // null for an anonymous caller, so an unbounded scan of the whole profiles
  // table was reachable without a session. "|" is 0x7C, so the exclusive upper
  // bound is the same prefix with "}" (0x7D) — every compound id for this user
  // and nothing else.
  const prefix = `${userId}|`;
  const legacy = await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) =>
      q.gte("userId", prefix).lt("userId", `${userId}}`)
    )
    .first();
  return legacy ?? null;
}

/**
 * The caller's own auth user id, or null when the request carries no valid
 * session. Resolves for every signed-in caller whether or not a profile row
 * exists, so the client can settle its identity without waiting on one.
 */
export const getMyUserId = query({
  args: {},
  handler: async (ctx) => {
    return await getAuthUserId(ctx);
  },
});

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await getProfileByUserId(ctx, userId);
    if (!profile) return null;

    // If profile has no email, try to get it from auth user record
    if (!profile.email) {
      const user = await ctx.db.get(userId);
      if (user?.email) {
        return { ...profile, email: user.email };
      }
    }
    return profile;
  },
});

/** Self-editable profile fields. A deployment may extend this set. */
export const profileUpdateArgs = {
  fullName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  company: v.optional(v.string()),
  linkedin: v.optional(v.string()),
  showName: v.optional(v.boolean()),
  showEmail: v.optional(v.boolean()),
  showLinkedin: v.optional(v.boolean()),
  showPhone: v.optional(v.boolean()),
  notifyUpdates: v.optional(v.boolean()),
  notifyMilestones: v.optional(v.boolean()),
};

/** Patch the caller's own profile with every field `args` defines. */
export async function updateMyProfileWith(
  ctx: MutationCtx,
  args: Record<string, string | boolean | undefined>,
) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");

  const profile = await getProfileByUserId(ctx, userId);
  if (!profile) throw new Error("Profile not found");

  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) updates[key] = value;
  }
  await ctx.db.patch(profile._id, updates);
}

export const updateMyProfile = mutation({
  args: profileUpdateArgs,
  handler: async (ctx, args) => updateMyProfileWith(ctx, args),
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await getProfileByUserId(ctx, userId);
    if (!profile || profile.role !== "admin") {
      throw new Error("Admin access required");
    }

    return await ctx.db.query("profiles").collect();
  },
});

/** Admin-only role change; an admin can never change their own role. */
export async function setProfileRole(
  ctx: MutationCtx,
  profileId: Id<"profiles">,
  role: Doc<"profiles">["role"],
) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const admin = await getProfileByUserId(ctx, userId);
  if (!admin || admin.role !== "admin") throw new Error("Admin access required");

  // Prevent self-demotion
  const target = await ctx.db.get(profileId);
  if (target && target.userId === userId) {
    throw new Error("Cannot change your own role");
  }

  await ctx.db.patch(profileId, { role });
}

export const updateRole = mutation({
  args: {
    profileId: v.id("profiles"),
    role: v.union(v.literal("pending"), v.literal("admin"), v.literal("rejected"), v.literal("alpha_tester")),
  },
  handler: async (ctx, args) => setProfileRole(ctx, args.profileId, args.role),
});

/** Sign-up fields `ensureProfile` fills when missing. A deployment may extend this set. */
export const ensureProfileArgs = {
  fullName: v.optional(v.string()),
  company: v.optional(v.string()),
  linkedin: v.optional(v.string()),
  phone: v.optional(v.string()),
};

/**
 * Create the caller's profile, or fill its empty fields from `args`. Every
 * key in `args` is a fill-if-missing string field on the profile row.
 */
export async function ensureProfileWith(
  ctx: MutationCtx,
  args: Record<string, string | undefined>,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");

  // Check if profile already exists (uses .first() — safe with duplicates)
  const existing = await getProfileByUserId(ctx, userId);
  if (existing) {
    // If found via legacy compound userId, migrate it in-place
    if (existing.userId !== userId) {
      await ctx.db.patch(existing._id, { userId });
    }

    // Backfill email from auth user table if profile is missing it
    const updates: Record<string, unknown> = {};
    if (!existing.email) {
      const user = await ctx.db.get(userId);
      if (user?.email) {
        updates.email = user.email;
      }
    }

    // Upsert: merge non-empty args into empty fields (fill-if-missing)
    const row = existing as Record<string, unknown>;
    for (const [key, value] of Object.entries(args)) {
      if (value && !row[key]) updates[key] = value;
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(existing._id, updates);
    }
    return existing._id;
  }

  // Get email from auth user table if identity doesn't have it
  let authEmail = identity.email;
  if (!authEmail) {
    const user = await ctx.db.get(userId);
    if (user?.email) {
      authEmail = user.email;
    }
  }

  // First-profile bootstrap (SECURITY): mint admin only when the profiles
  // table is empty AND the deployment's bootstrap policy admits this email.
  // On a fresh or freshly-purged backend an arbitrary signup must NOT
  // inherit admin just by being first. Everyone else starts as "pending"
  // and a real admin promotes them via updateRole.
  let role: "pending" | "admin" = "pending";
  const anyProfile = await ctx.db.query("profiles").first();
  if (!anyProfile && firstProfileMintsAdmin(authEmail)) {
    role = "admin";
  }

  return await ctx.db.insert("profiles", {
    ...args,
    userId,
    role,
    fullName: args.fullName || (identity.name ?? undefined),
    email: authEmail ?? undefined,
    showName: false,
    showEmail: false,
    showLinkedin: false,
    showPhone: false,
    notifyUpdates: true,
    notifyMilestones: true,
  });
}

export const ensureProfile = mutation({
  args: ensureProfileArgs,
  handler: async (ctx, args) => ensureProfileWith(ctx, args),
});

/** How duplicate profiles of one user are merged into the oldest. */
export interface ProfileMergePolicy {
  /** Fields copied from a duplicate when the canonical row lacks them. */
  fillKeys: readonly string[];
  /** Higher rank wins when the duplicates disagree on role. */
  roleRank: Readonly<Record<string, number>>;
}

export const SHARED_PROFILE_MERGE: ProfileMergePolicy = {
  fillKeys: ["fullName", "email", "phone", "company", "linkedin"],
  // Prefer highest role: admin > tester > pending > rejected
  roleRank: { admin: 3, alpha_tester: 2, pilot: 1, pending: 1, rejected: 0 },
};

export async function deduplicateProfilesImpl(ctx: MutationCtx, policy: ProfileMergePolicy) {
    const allProfiles = await ctx.db.query("profiles").collect();

    // Group by userId
    const byUser = new Map<string, typeof allProfiles>();
    for (const p of allProfiles) {
      const group = byUser.get(p.userId) ?? [];
      group.push(p);
      byUser.set(p.userId, group);
    }

    let mergedCount = 0;
    let deletedCount = 0;

    for (const [, profiles] of byUser) {
      if (profiles.length <= 1) continue;

      // Sort by creation time (oldest first — _creationTime is built-in)
      profiles.sort((a, b) => a._creationTime - b._creationTime);
      const canonical = profiles[0];
      const canonicalRow = canonical as Record<string, unknown>;
      const duplicates = profiles.slice(1);

      // Merge data from duplicates into canonical (fill-if-missing)
      const updates: Record<string, unknown> = {};
      for (const dup of duplicates) {
        const dupRow = dup as Record<string, unknown>;
        for (const key of policy.fillKeys) {
          if (dupRow[key] && !canonicalRow[key] && !updates[key]) updates[key] = dupRow[key];
        }
        const currentRole = (updates.role as string) ?? canonical.role;
        if ((policy.roleRank[dup.role] ?? 0) > (policy.roleRank[currentRole] ?? 0)) {
          updates.role = dup.role;
        }
      }

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(canonical._id, updates);
        mergedCount++;
      }

      // Delete duplicates
      for (const dup of duplicates) {
        await ctx.db.delete(dup._id);
        deletedCount++;
      }
    }

    return { mergedCount, deletedCount };
}

/** Admin gate for the dedupe mutation, shared with deployment overlays. */
export async function requireAdminProfile(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const admin = await getProfileByUserId(ctx, userId);
  if (!admin || admin.role !== "admin") throw new Error("Admin access required");
  return admin;
}

export const deduplicateProfiles = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdminProfile(ctx);
    return await deduplicateProfilesImpl(ctx, SHARED_PROFILE_MERGE);
  },
});

/** CLI-callable version (no auth required). */
export const deduplicateProfilesInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await deduplicateProfilesImpl(ctx, SHARED_PROFILE_MERGE);
  },
});

/**
 * One-time migration: strip compound "userId|sessionId" down to stable "userId".
 * Run from Convex dashboard after deploying the getAuthUserId fix.
 */
export const migrateProfileUserIds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allProfiles = await ctx.db.query("profiles").collect();
    let migratedCount = 0;

    for (const profile of allProfiles) {
      if (profile.userId.includes("|")) {
        const stableId = profile.userId.split("|")[0];
        await ctx.db.patch(profile._id, { userId: stableId });
        migratedCount++;
      }
    }

    return { migratedCount, total: allProfiles.length };
  },
});
