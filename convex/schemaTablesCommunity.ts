/**
 * @module schemaTablesCommunity
 * @description Account, community and plugin-catalog tables.
 *
 * Shared by every deployment; composed by `schemaTables.ts`. The four tables
 * a deployment may widen (profiles, contact submissions, registry plugins and
 * registry submissions) are exported as field objects with a default table, so
 * a deployment schema can spread its own columns into the same definition.
 *
 * @license GPL-3.0-only
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

/** The roles every deployment's profiles carry. */
export const profileRoleValidator = v.union(
  v.literal("pending"),
  v.literal("admin"),
  v.literal("rejected"),
  v.literal("pilot"),
  v.literal("alpha_tester")
);

/** Profile columns other than `role`. */
export const profilesFields = {
  userId: v.string(),
  fullName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  company: v.optional(v.string()),
  linkedin: v.optional(v.string()),
  showName: v.optional(v.boolean()),
  showEmail: v.optional(v.boolean()),
  showLinkedin: v.optional(v.boolean()),
  showPhone: v.optional(v.boolean()),
  notifyUpdates: v.boolean(),
  notifyMilestones: v.boolean(),
};

export const contactSubmissionsFields = {
  name: v.string(),
  email: v.string(),
  subject: v.optional(v.string()),
  message: v.string(),
  source: v.optional(v.string()),
  company: v.optional(v.string()),
  linkedin: v.optional(v.string()),
};

export const registryPluginsFields = {
  plugin_id: v.string(),
  name: v.string(),
  description: v.string(),
  category: v.union(
    v.literal("drivers"),
    v.literal("ui"),
    v.literal("ai"),
    v.literal("telemetry"),
    v.literal("tools"),
  ),
  author_id: v.string(),
  verified_publisher: v.boolean(),
  repo_url: v.optional(v.string()),
  homepage_url: v.optional(v.string()),
  license: v.string(),
  total_installs: v.number(),
  created_at: v.number(),
  updated_at: v.number(),
  latest_version: v.string(),
  status: v.union(
    v.literal("draft"),
    v.literal("published"),
    v.literal("deprecated"),
    v.literal("removed"),
  ),
  icon_url: v.optional(v.string()),
  screenshot_urls: v.optional(v.array(v.string())),
  tier: v.optional(v.union(
    v.literal("first_party"),
    v.literal("verified"),
    v.literal("community"),
  )),
};

export const registrySubmissionsFields = {
  submission_id: v.string(),
  plugin_id: v.string(),
  version: v.string(),
  submitter_user_id: v.string(),
  archive_storage_id: v.id("_storage"),
  status: v.union(
    v.literal("pending"),
    v.literal("auto_approved"),
    v.literal("queued_for_review"),
    v.literal("approved"),
    v.literal("rejected"),
  ),
  static_analysis_score: v.number(),
  static_analysis_findings_json: v.string(),
  submitted_at: v.number(),
  reviewed_at: v.optional(v.number()),
  reviewer_user_id: v.optional(v.string()),
  review_notes: v.optional(v.string()),
};

export const communityTables = {
  profiles: defineTable({ ...profilesFields, role: profileRoleValidator }).index("by_userId", ["userId"]),

  contactSubmissions: defineTable(contactSubmissionsFields),

  comments: defineTable({
    targetType: v.union(
      v.literal("update"),
      v.literal("milestone"),
      v.literal("document"),
      v.literal("general"),
      v.literal("grant"),
      v.literal("changelog"),
      v.literal("community_item")
    ),
    targetId: v.string(),
    authorId: v.id("profiles"),
    body: v.string(),
    deleted: v.optional(v.boolean()),
  })
    .index("by_target", ["targetType", "targetId"])
    .index("by_author", ["authorId"]),

  // ── Community tables ────────────────────────────────────────

  community_changelog: defineTable({
    version: v.string(),
    title: v.string(),
    body: v.string(),
    bodyHtml: v.optional(v.string()),
    publishedAt: v.number(),
    authorId: v.id("profiles"),
    authorName: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    published: v.boolean(),
    source: v.optional(v.union(v.literal("auto"), v.literal("manual"))),
    commitShas: v.optional(v.array(v.string())),
    commitSha: v.optional(v.string()),
    commitUrl: v.optional(v.string()),
    commitDate: v.optional(v.number()),
    editedByAdmin: v.optional(v.boolean()),
    repo: v.optional(v.string()),
    translations: v.optional(v.record(v.string(), v.object({
      title: v.string(),
      description: v.string(),
    }))),
  })
    .index("by_publishedAt", ["published", "publishedAt"])
    .index("by_version", ["version"])
    .index("by_commitSha", ["commitSha"]),

  changelog_sync_state: defineTable({
    lastSyncedSha: v.string(),
    lastSyncedAt: v.number(),
    repo: v.string(),
  }).index("by_repo", ["repo"]),

  community_items: defineTable({
    type: v.union(v.literal("feature"), v.literal("bug")),
    title: v.string(),
    body: v.string(),
    authorId: v.id("profiles"),
    status: v.union(
      v.literal("backlog"),
      v.literal("in_discussion"),
      v.literal("planned"),
      v.literal("in_progress"),
      v.literal("released"),
      v.literal("wont_do"),
    ),
    category: v.union(
      v.literal("command"),
      v.literal("ados"),
      v.literal("website"),
      v.literal("general"),
    ),
    priority: v.optional(v.union(
      v.literal("low"), v.literal("medium"),
      v.literal("high"), v.literal("critical"),
    )),
    upvoteCount: v.number(),
    eta: v.optional(v.string()),
    resolvedVersion: v.optional(v.string()),
    translations: v.optional(v.record(v.string(), v.object({
      title: v.string(),
      description: v.string(),
    }))),
  })
    .index("by_type_status", ["type", "status"])
    .index("by_type_upvotes", ["type", "upvoteCount"])
    .index("by_category", ["category"])
    .index("by_status", ["status"]),

  community_upvotes: defineTable({
    itemId: v.id("community_items"),
    userId: v.string(),
  })
    .index("by_item", ["itemId"])
    .index("by_user_item", ["userId", "itemId"]),

  changelog_reactions: defineTable({
    changelogId: v.id("community_changelog"),
    userId: v.string(),
    reaction: v.string(),
  })
    .index("by_changelog", ["changelogId"])
    .index("by_user_changelog", ["userId", "changelogId"]),

  // Maintained counters for community_changelog, so the public count query
  // reads one row instead of the whole table. Keyed by counter name.
  community_changelog_counts: defineTable({
    key: v.string(),
    count: v.number(),
  }).index("by_key", ["key"]),

  // ── Plugin registry tables ──────────────────────────────────
  // Public-read catalog so self-hosted GCS instances can list and resolve
  // plugins independently of any central deployment; reads are served by
  // the queries in convex/pluginRegistry.ts.
  registry_plugins: defineTable(registryPluginsFields)
    .index("by_plugin_id", ["plugin_id"])
    .index("by_category", ["category", "status"])
    .index("by_author", ["author_id"]),

  registry_versions: defineTable({
    plugin_id: v.string(),
    version: v.string(),
    manifest_yaml: v.string(),
    download_url: v.string(),
    signer_key_id: v.string(),
    signature: v.string(),
    payload_hash: v.string(),
    archive_size_bytes: v.number(),
    archive_sha256: v.string(),
    agent_min_version: v.string(),
    agent_max_version: v.optional(v.string()),
    gcs_min_version: v.optional(v.string()),
    released_at: v.number(),
    static_analysis_score: v.number(),
    static_analysis_report_json: v.string(),
    download_count: v.number(),
    supported_boards: v.optional(v.array(v.string())),
    release_notes_md: v.optional(v.string()),
    contains_vendor_binary: v.optional(v.boolean()),
    vendor_attribution: v.optional(v.array(v.object({
      name: v.string(),
      license: v.string(),
      source_url: v.string(),
      notice: v.optional(v.string()),
    }))),
  })
    .index("by_plugin_version", ["plugin_id", "version"])
    .index("by_plugin_released", ["plugin_id", "released_at"]),

  registry_submissions: defineTable(registrySubmissionsFields)
    .index("by_status_submitted", ["status", "submitted_at"])
    .index("by_plugin", ["plugin_id"])
    .index("by_submitter", ["submitter_user_id", "submitted_at"]),

  registry_revocations: defineTable({
    revocation_id: v.string(),
    kind: v.union(
      v.literal("signer_key"),
      v.literal("plugin_version"),
    ),
    target: v.string(),
    reason: v.string(),
    revoked_at: v.number(),
    revoked_by_user_id: v.string(),
  })
    .index("by_kind", ["kind", "revoked_at"]),

  // First-party parameter-metadata registry: version-matched firmware snapshots
  // (gzipped {provenance,params}, base64-encoded inline). Public read; admin
  // (internal) write. Generic technical reference data, present in both convex
  // dirs. Overlays the bundled offline floor in the GCS.
  param_registry: defineTable({
    firmware: v.string(),
    version: v.string(),
    param_count: v.number(),
    gz_b64: v.string(),
    updated_at: v.number(),
  })
    .index("by_firmware", ["firmware"])
    .index("by_firmware_version", ["firmware", "version"]),
};
