/**
 * @module convex/lib/pluginInstalls
 * @description Install-row persistence behind the `cmdPlugins` mutations:
 * recording a verified install, tearing an install down with everything that
 * hangs off it, and logging lifecycle transitions.
 *
 * @license GPL-3.0-only
 */

import { v, type ObjectType } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  sourceValidator,
  halfValidator,
  gcsContributesValidator,
  gcsIsolationValidator,
  gcsParametersValidator,
  flightSkillsValidator,
  targetActionsValidator,
} from "../cmdPluginsValidators";
import { purgeRecordsForRemovedInstall } from "../pluginRecords";

/**
 * Delete an install and everything that hangs off it: permission rows, the
 * event log, the stored GCS bundle with its ownership row, and (unless the
 * install is being replaced in place) the plugin records it leaves behind.
 * `keepBundle` names a bundle the replacing install still references (a
 * retried record of the same upload), which is left in place. A replacement
 * passes `keepRecords` so re-installing or upgrading keeps the plugin's
 * history.
 */
export async function deleteInstallTree(
  ctx: Pick<MutationCtx, "db" | "storage" | "scheduler">,
  install: Doc<"cmd_pluginInstalls">,
  opts: { keepBundle?: Id<"_storage">; keepRecords?: boolean } = {},
): Promise<void> {
  const perms = await ctx.db
    .query("cmd_pluginPermissions")
    .withIndex("by_install", (q) => q.eq("pluginInstallId", install._id))
    .collect();
  for (const p of perms) await ctx.db.delete(p._id);
  const events = await ctx.db
    .query("cmd_pluginEvents")
    .withIndex("by_install", (q) => q.eq("pluginInstallId", install._id))
    .collect();
  for (const e of events) await ctx.db.delete(e._id);
  const storageId = install.bundleStorageId;
  if (storageId && storageId !== opts.keepBundle) {
    const owner = await ctx.db
      .query("cmd_pluginBundles")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .first();
    if (owner) await ctx.db.delete(owner._id);
    await ctx.storage.delete(storageId);
  }
  if (!opts.keepRecords) await purgeRecordsForRemovedInstall(ctx, install);
  await ctx.db.delete(install._id);
}

/** Args of the `recordInstall` mutation. */
export const recordInstallArgs = {
    droneId: v.optional(v.string()),
    pluginId: v.string(),
    version: v.string(),
    name: v.string(),
    source: sourceValidator,
    sourceUri: v.optional(v.string()),
    signerId: v.optional(v.string()),
    manifestHash: v.string(),
    halves: v.array(halfValidator),
    declaredPermissions: v.array(
      v.object({
        id: v.string(),
        required: v.boolean(),
      }),
    ),
    bundleStorageId: v.optional(v.id("_storage")),
    gcsContributes: v.optional(gcsContributesValidator),
    gcsIsolation: v.optional(gcsIsolationValidator),
    // The install dialog sends these on EVERY install (see the GCS's
    // finalize-gcs-install). A Convex args validator rejects the whole call on
    // an undeclared arg, so a deployment that omits them does not lose the
    // parameter/skill/target-action contributions -- it fails the install
    // outright.
    gcsParameters: v.optional(gcsParametersValidator),
    flightSkills: v.optional(flightSkillsValidator),
    targetActions: v.optional(targetActionsValidator),
};

/**
 * Record a fresh plugin install for `userId`. Permissions land as
 * `granted=false` rows; the operator approves them through `grantPermission`.
 */
export async function recordInstallFor(
  ctx: MutationCtx,
  userId: string,
  args: ObjectType<typeof recordInstallArgs>,
): Promise<Id<"cmd_pluginInstalls">> {
if (args.halves.length === 0) {
  throw new Error("plugin must declare at least one half");
}

const bundleStorageId = args.bundleStorageId;
if (bundleStorageId) {
  const owner = await ctx.db
    .query("cmd_pluginBundles")
    .withIndex("by_storageId", (q) => q.eq("storageId", bundleStorageId))
    .first();
  if (!owner || owner.userId !== userId) {
    throw new Error("bundle was not stored for this user");
  }
}

// Upsert per drone: installing on drone B leaves drone A's install and
// grants alone. Re-installing on the same drone replaces its row, and the
// old row's grants, events and bundle go with it.
const existing = await ctx.db
  .query("cmd_pluginInstalls")
  .withIndex("by_user_drone_plugin", (q) =>
    q.eq("userId", userId).eq("droneId", args.droneId).eq("pluginId", args.pluginId),
  )
  .first();
if (existing) {
  await deleteInstallTree(ctx, existing, { keepBundle: bundleStorageId, keepRecords: true });
}

const installedAt = Date.now();
const installId: Id<"cmd_pluginInstalls"> = await ctx.db.insert(
  "cmd_pluginInstalls",
  {
    userId,
    droneId: args.droneId,
    pluginId: args.pluginId,
    version: args.version,
    name: args.name,
    source: args.source,
    sourceUri: args.sourceUri,
    signerId: args.signerId,
    manifestHash: args.manifestHash,
    status: "installed" as const,
    bundleStorageId: args.bundleStorageId,
    gcsContributes: args.gcsContributes,
    gcsIsolation: args.gcsIsolation,
    gcsParameters: args.gcsParameters,
    flightSkills: args.flightSkills,
    targetActions: args.targetActions,
    halves: args.halves,
    installedAt,
  },
);

for (const perm of args.declaredPermissions) {
  await ctx.db.insert("cmd_pluginPermissions", {
    userId,
    pluginInstallId: installId,
    pluginId: args.pluginId,
    permissionId: perm.id,
    granted: false,
    required: perm.required,
  });
}

await ctx.db.insert("cmd_pluginEvents", {
  userId,
  pluginInstallId: installId,
  pluginId: args.pluginId,
  type: "installed" as const,
  severity: "info" as const,
  message: `Installed ${args.pluginId} v${args.version}`,
  payload: {
    signerId: args.signerId,
    source: args.source,
  },
  createdAt: installedAt,
});

return installId;
}

/** Append the event row a lifecycle status change implies, if any. */
export async function logLifecycleEvent(
  ctx: MutationCtx,
  install: Doc<"cmd_pluginInstalls">,
  status: Doc<"cmd_pluginInstalls">["status"],
): Promise<void> {
  const map: Partial<Record<typeof status, Doc<"cmd_pluginEvents">["type"]>> = {
    installed: "installed",
    enabled: "enabled",
    running: "started",
    disabled: "disabled",
    crashed: "crashed",
    removed: "removed",
  };
  const eventType = map[status];
  if (!eventType) return;
  await ctx.db.insert("cmd_pluginEvents", {
    userId: install.userId,
    pluginInstallId: install._id,
    pluginId: install.pluginId,
    type: eventType,
    severity: status === "crashed" ? "error" : "info",
    message: `Plugin ${install.pluginId} -> ${status}`,
    createdAt: Date.now(),
  });
}
