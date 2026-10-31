/**
 * @module convex/lib/pluginPermissions
 * @description Grant and revoke one declared plugin permission for its owner,
 * logging the change to the install's event log.
 *
 * @license GPL-3.0-only
 */

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Approve one declared permission. Throws if the permission was not
 * declared in the manifest at install time, defending against a
 * tampered client that tries to widen scope.
 */
export async function grantPermissionFor(
  ctx: MutationCtx,
  userId: string,
  installId: Id<"cmd_pluginInstalls">,
  permissionId: string,
): Promise<Id<"cmd_pluginPermissions">> {
  const install = await ctx.db.get(installId);
  if (!install || install.userId !== userId) {
    throw new Error("install not found");
  }
  const row = await ctx.db
    .query("cmd_pluginPermissions")
    .withIndex("by_install_perm", (q) =>
      q.eq("pluginInstallId", installId).eq("permissionId", permissionId),
    )
    .first();
  if (!row) {
    throw new Error(
      `permission ${permissionId} was not declared in the manifest`,
    );
  }
  if (row.granted) return row._id;
  const now = Date.now();
  await ctx.db.patch(row._id, {
    granted: true,
    grantedAt: now,
    grantedBy: userId,
    revokedAt: undefined,
  });
  await ctx.db.insert("cmd_pluginEvents", {
    userId,
    pluginInstallId: installId,
    pluginId: install.pluginId,
    type: "permission_granted" as const,
    severity: "info" as const,
    message: `Granted ${permissionId}`,
    createdAt: now,
  });
  return row._id;
}

/**
 * Revoke one previously-granted permission. A permission the manifest declares
 * as required cannot be revoked piecemeal; the operator removes the plugin.
 */
export async function revokePermissionFor(
  ctx: MutationCtx,
  userId: string,
  installId: Id<"cmd_pluginInstalls">,
  permissionId: string,
): Promise<void> {
  const install = await ctx.db.get(installId);
  if (!install || install.userId !== userId) {
    throw new Error("install not found");
  }
  const row = await ctx.db
    .query("cmd_pluginPermissions")
    .withIndex("by_install_perm", (q) =>
      q.eq("pluginInstallId", installId).eq("permissionId", permissionId),
    )
    .first();
  if (!row || !row.granted) return;
  if (row.required) {
    throw new Error(
      `permission ${permissionId} is required by the manifest; remove the plugin instead`,
    );
  }
  const now = Date.now();
  await ctx.db.patch(row._id, {
    granted: false,
    revokedAt: now,
  });
  await ctx.db.insert("cmd_pluginEvents", {
    userId,
    pluginInstallId: installId,
    pluginId: install.pluginId,
    type: "permission_revoked" as const,
    severity: "warning" as const,
    message: `Revoked ${permissionId}`,
    createdAt: now,
  });
}
