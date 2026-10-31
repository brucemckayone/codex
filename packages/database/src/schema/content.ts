import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { subscriptionTiers } from './subscriptions';
import { users } from './users';

/**
 * Organization Memberships
 * Tracks user membership in organizations with roles and status
 *
 * Roles:
 * - owner: Organization creator, full control
 * - admin: Administrative access, can manage members
 * - creator: Can publish content to the organization
 * - subscriber: Paid subscriber access to org content
 * - member: Basic member access
 *
 * Status:
 * - active: Current member with full access
 * - inactive: Suspended or lapsed membership
 * - invited: Pending invitation acceptance
 */
export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Role and status with CHECK constraints
    role: varchar('role', { length: 50 }).notNull().default('member'),
    status: varchar('status', { length: 50 }).notNull().default('active'),

    // Invitation tracking
    invitedBy: text('invited_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Indexes
    uniqueIndex('idx_unique_org_membership').on(
      table.organizationId,
      table.userId
    ),
    index('idx_org_memberships_org_id').on(table.organizationId),
    index('idx_org_memberships_user_id').on(table.userId),
    index('idx_org_memberships_role').on(table.organizationId, table.role),
    index('idx_org_memberships_status').on(table.organizationId, table.status),
    index('idx_org_memberships_org_active_role')
      .on(table.organizationId, table.status, table.role)
      .where(sql`${table.status} = 'active'`),
    // One active owner per organisation (Codex-2hxff.2). Partial on status so
    // an inactive row never collides — though 0097 demoted every removed
    // owner's row to 'member', and an active owner can no longer be removed.
    // Not deferrable, so it is checked row by row: a transfer must DEMOTE the
    // old owner in an earlier statement than the one that promotes the new.
    uniqueIndex('uq_org_memberships_one_active_owner')
      .on(table.organizationId)
      .where(sql`${table.role} = 'owner' AND ${table.status} = 'active'`),

    // CHECK constraints for enum values
    check(
      'check_membership_role',
      sql`${table.role} IN ('owner', 'admin', 'creator', 'subscriber', 'member')`
    ),
    check(
      'check_membership_status',
      sql`${table.status} IN ('active', 'inactive', 'invited')`
    ),
  ]
);

/**
 * Media items (uploaded videos/audio)
 * Aligned with database-schema.md lines 130-183
 * Creator-owned, stored in creator's R2 bucket
 * Separate from content for reusability
 */
export const mediaItems = pgTable(
  'media_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    // Basic Info
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    mediaType: varchar('media_type', { length: 50 }).notNull(), // 'video' | 'audio'
    status: varchar('status', { length: 50 }).default('uploading').notNull(),
    // 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'

    // R2 Storage - Single MEDIA_BUCKET with creator subfolder structure:
    // {creatorId}/originals/{mediaId}/video.mp4 (uploads)
    // {creatorId}/hls/{mediaId}/master.m3u8 (transcoded)
    // {creatorId}/thumbnails/{mediaId}/thumb.jpg
    // {creatorId}/waveforms/{mediaId}/waveform.json
    r2Key: varchar('r2_key', { length: 500 }).notNull(), // "originals/{media_id}/video.mp4"
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
    mimeType: varchar('mime_type', { length: 100 }),

    // Media Metadata
    durationSeconds: integer('duration_seconds'),
    width: integer('width'), // For video
    height: integer('height'), // For video

    // HLS Transcoding (Phase 1+)
    hlsMasterPlaylistKey: varchar('hls_master_playlist_key', { length: 500 }), // "hls/{media_id}/master.m3u8"
    hlsPreviewKey: varchar('hls_preview_key', { length: 500 }), // "hls/{media_id}/preview/preview.m3u8" - 30s preview
    thumbnailKey: varchar('thumbnail_key', { length: 500 }), // "thumbnails/{media_id}/thumb.jpg"

    // Audio Waveform (audio only)
    waveformKey: varchar('waveform_key', { length: 500 }), // "waveforms/{media_id}/waveform.json"
    waveformImageKey: varchar('waveform_image_key', { length: 500 }), // "waveforms/{media_id}/waveform.png"

    // Transcoding Job Tracking
    runpodJobId: varchar('runpod_job_id', { length: 255 }), // RunPod job ID for tracking
    transcodingError: varchar('transcoding_error', { length: 2000 }), // Error message (max 2KB to prevent DoS)
    transcodingAttempts: integer('transcoding_attempts').default(0).notNull(), // Retry count (max 3, enforced by CHECK constraint)
    transcodingPriority: integer('transcoding_priority').default(2).notNull(), // 0=urgent, 2=normal, 4=backlog
    transcodingProgress: integer('transcoding_progress'), // 0-100, null when not transcoding
    transcodingStep: varchar('transcoding_step', { length: 50 }), // Current step label, null when not transcoding
    // Why the transcoder is not running this item, as a TRANSCODING_ERROR_CODES
    // code (@codex/constants): on `uploaded`, it is waiting for the transcoder;
    // on `failed`, why it failed (rows that failed before codes existed carry
    // INFRA_ERROR). `transcodingError` holds the detail. Null when nothing has
    // gone wrong. Length = TRANSCODING_ERROR_CODE_MAX_LENGTH, kept a literal:
    // drizzle-kit loads this file through a CJS shim that reads a missing
    // export from a stale constants dist as undefined, i.e. an unsized varchar.
    // A transcoding test pins the two together.
    transcodingErrorCode: varchar('transcoding_error_code', { length: 50 }),

    // Mezzanine/Archive (extensibility)
    mezzanineKey: varchar('mezzanine_key', { length: 500 }), // Archive-quality intermediate
    mezzanineStatus: varchar('mezzanine_status', { length: 50 }), // pending|processing|ready|failed

    // HLS Variants Tracking
    readyVariants: jsonb('ready_variants').$type<string[]>(), // ["1080p", "720p", "480p", "360p"]

    // Audio Loudness (stored as integer × 100 for precision)
    loudnessIntegrated: integer('loudness_integrated'), // LUFS × 100 (e.g., -14.0 LUFS = -1400)
    loudnessPeak: integer('loudness_peak'), // dBTP × 100 (e.g., -1.0 dBTP = -100)
    loudnessRange: integer('loudness_range'), // LRA × 100 (e.g., 7.0 LU = 700)

    // Timestamps
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    // The files a delete keeps for 30 days (Codex-6sbn1). A delete sets
    // `deletedAt` and `filesPurgeAfter` = then + 30 days and leaves R2 alone;
    // media-api's daily purge removes the files once it passes. The purge
    // stamps `filesPurgeStartedAt` before its first R2 delete (the claim) and
    // `filesPurgedAt` once every prefix is gone. A restore is refused from the
    // claim on, so a half-removed item can never come back; a run that failed
    // part-way keeps the claim, and a later run finishes the item. Rows deleted
    // before this shipped lost their files at once and keep `filesPurgeAfter`
    // NULL, so the purge never lists them and restore refuses them. Support
    // can hold an item's files longer by moving `filesPurgeAfter`. Never
    // served (MEDIA_ITEM_RESPONSE_COLUMNS).
    filesPurgeAfter: timestamp('files_purge_after', { withTimezone: true }),
    filesPurgeStartedAt: timestamp('files_purge_started_at', {
      withTimezone: true,
    }),
    filesPurgedAt: timestamp('files_purged_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_media_items_creator_id').on(table.creatorId),
    index('idx_media_items_status').on(table.creatorId, table.status),
    index('idx_media_items_type').on(table.creatorId, table.mediaType),
    index('idx_media_items_runpod_job_id').on(table.runpodJobId), // For webhook callback queries
    index('idx_media_items_transcoding_status').on(
      table.status,
      table.transcodingAttempts
    ), // For efficient polling/retry queries
    // The purge's due list: deleted, files kept, window set (Codex-6sbn1).
    index('idx_media_items_files_purge_due')
      .on(table.filesPurgeAfter)
      .where(
        sql`${table.deletedAt} IS NOT NULL AND ${table.filesPurgedAt} IS NULL AND ${table.filesPurgeAfter} IS NOT NULL`
      ),

    // CHECK constraints
    check(
      'check_media_status',
      sql`${table.status} IN ('uploading', 'uploaded', 'transcoding', 'ready', 'failed')`
    ),
    check('check_media_type', sql`${table.mediaType} IN ('video', 'audio')`),
    check(
      'check_mezzanine_status',
      sql`${table.mezzanineStatus} IS NULL OR ${table.mezzanineStatus} IN ('pending', 'processing', 'ready', 'failed')`
    ),
    check(
      'check_transcoding_priority',
      sql`${table.transcodingPriority} >= 0 AND ${table.transcodingPriority} <= 4`
    ),
    check(
      'check_max_transcoding_attempts',
      sql`${table.transcodingAttempts} >= 0 AND ${table.transcodingAttempts} <= 3`
    ),
    check(
      'check_transcoding_progress_range',
      sql`${table.transcodingProgress} IS NULL OR (${table.transcodingProgress} >= 0 AND ${table.transcodingProgress} <= 100)`
    ),

    // Media lifecycle constraint: status='ready' requires transcoding outputs
    // Video: needs HLS + thumbnail + duration
    // Audio: needs HLS + waveform + duration
    check(
      'status_ready_requires_keys',
      sql`${table.status} != 'ready' OR (
        ${table.hlsMasterPlaylistKey} IS NOT NULL
        AND ${table.durationSeconds} IS NOT NULL
        AND (
          (${table.mediaType} = 'video' AND ${table.thumbnailKey} IS NOT NULL)
          OR (${table.mediaType} = 'audio' AND ${table.waveformKey} IS NOT NULL)
        )
      )`
    ),
  ]
);

/**
 * Published content (references media items)
 * Aligned with database-schema.md lines 185-254
 * Can belong to organization OR creator's personal profile
 */
export const content = pgTable(
  'content',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }), // NULL = personal profile

    // Media Reference (separates content from media for reusability)
    mediaItemId: uuid('media_item_id').references(() => mediaItems.id, {
      onDelete: 'set null',
    }),
    // NULL for written content (Phase 2)

    // Basic Info
    title: varchar('title', { length: 500 }).notNull(),
    slug: varchar('slug', { length: 500 }).notNull(), // Unique per organization
    description: text('description'),
    contentType: varchar('content_type', { length: 50 }).notNull(),
    // 'video' | 'audio' | 'written' (Phase 1: video, audio only)

    // Thumbnail (optional custom thumbnail)
    thumbnailUrl: text('thumbnail_url'),

    // Written content (Phase 2+)
    contentBody: text('content_body'),
    contentBodyJson:
      jsonb('content_body_json').$type<Record<string, unknown>>(),

    // Organization (simplified for Phase 1)
    category: varchar('category', { length: 100 }), // Simple string category
    tags: jsonb('tags').$type<string[]>().default([]), // Array of tag strings

    // Shader preset for immersive audio playback mode (Phase 2)
    shaderPreset: varchar('shader_preset', { length: 50 }),
    shaderConfig:
      jsonb('shader_config').$type<Record<string, number | boolean>>(),

    // Content access POLICY (SPEC §6.1) — separable, non-exclusive flags that
    // REPLACE the single `accessType` enum. Structurally mirrors
    // ContentAccessPolicy in @codex/shared-types (WP-0 frozen contract); read by
    // the entitlement resolver (@codex/access, WP-2).
    //
    // Legacy accessType → flag mapping (HARDENING §H2): free→isFree,
    // paid→isPurchasable, subscribers→isTierGated, followers→isFollowerGated,
    // team→isTeamOnly. `courseOnly` is net-new. `isPurchasable` and
    // `isTierGated` may combine; `isTierGated` excludes `isFree`, followers,
    // team and course-only (Codex-2hxff.91 I2/I4); `courseOnly` suppresses
    // every standalone path regardless of the others.
    isFree: boolean('is_free').notNull().default(true), // open to all
    isPurchasable: boolean('is_purchasable').notNull().default(false), // one-off purchase (+ priceCents)

    priceCents: integer('price_cents'), // Paired with isPurchasable — one-off price in pence (NULL = not priced)

    // The subscribers-only SWITCH (Codex-2hxff.91): the tier arm applies. The
    // tiers that open it are the rows of `content_tier_access`. Gated with no
    // tier ticked is CLOSED (buyers, granted users, course owners and the team
    // only), never free. Every "is it gated?" check reads THIS, never "has
    // ticks" and never the legacy column below.
    isTierGated: boolean('is_tier_gated').notNull().default(false),

    // LEGACY (Codex-2hxff.91 phase 1-2 only): the old single "this tier and
    // above" column. Renamed so every reader fails typecheck; nothing decides
    // access from it any more. Dual-written as the lowest ticked tier (kept,
    // never NULLed, while gated with no tick) for the old web and a rollback,
    // ONLY by `packages/content/src/services/content-tier-access.ts`
    // `syncLegacyIncludedInTierId`. Dropped in the cleanup release.
    legacyIncludedInTierId: uuid('included_in_tier_id').references(
      () => subscriptionTiers.id,
      { onDelete: 'set null' }
    ),

    // NOT independently reachable — ONLY via a course entitlement (SPEC §6.1).
    courseOnly: boolean('course_only').notNull().default(false),
    // Free to org followers / opt-in (was accessType 'followers').
    isFollowerGated: boolean('is_follower_gated').notNull().default(false),
    // Management/staff-only (was accessType 'team'); also covered by resolver role-bypass.
    isTeamOnly: boolean('is_team_only').notNull().default(false),

    // Status
    status: varchar('status', { length: 50 }).default('draft').notNull(),
    // 'draft' | 'published' | 'archived'
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // When the item was taken off sale because its creator left the
    // organisation (status -> 'archived'; Codex-2hxff.64). Tier subscribers
    // keep it until their next renewal: access while off_sale_at >= their
    // current period start. Cleared when the item is republished.
    offSaleAt: timestamp('off_sale_at', { withTimezone: true }),

    // Creator-flagged feature — promotes the item to a full-width editorial
    // card on the org homepage feed. Orthogonal to status: only published
    // items actually surface; the flag just marks intent.
    featured: boolean('featured').default(false).notNull(),

    // Metadata
    viewCount: integer('view_count').default(0).notNull(),
    purchaseCount: integer('purchase_count').default(0).notNull(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Indexes
    index('idx_content_creator_id').on(table.creatorId),
    index('idx_content_organization_id').on(table.organizationId),
    index('idx_content_media_item_id').on(table.mediaItemId),
    index('idx_content_slug_org').on(table.slug, table.organizationId),
    index('idx_content_status').on(table.status),
    index('idx_content_published_at').on(table.publishedAt),
    index('idx_content_category').on(table.category),
    index('idx_content_included_in_tier').on(table.legacyIncludedInTierId),

    // Composite-FK target for `content_tier_access` (Codex-2hxff.91). `id` is
    // the PK, so this is redundant for uniqueness, exactly as
    // `uq_courses_id_org` / `uq_subscription_tiers_id_org`.
    uniqueIndex('uq_content_id_org').on(table.id, table.organizationId),

    // Composite indexes for landing page query performance
    index('idx_content_org_published')
      .on(table.organizationId, table.status, table.publishedAt)
      .where(sql`${table.deletedAt} IS NULL`),
    index('idx_content_creator_org_published')
      .on(table.creatorId, table.organizationId, table.status)
      .where(sql`${table.deletedAt} IS NULL`),

    // Partial index for org homepage "featured" lookup — tiny (1–3 rows/org)
    index('idx_content_org_featured')
      .on(table.organizationId, table.publishedAt)
      .where(
        sql`${table.featured} = true AND ${table.status} = 'published' AND ${table.deletedAt} IS NULL`
      ),

    // Partial unique indexes for slug uniqueness (exclude soft-deleted rows)
    // Unique slug per organization (for organization content)
    uniqueIndex('idx_unique_content_slug_per_org')
      .on(table.slug, table.organizationId)
      .where(
        sql`${table.organizationId} IS NOT NULL AND ${table.deletedAt} IS NULL`
      ),

    // Unique slug per creator (for personal content)
    uniqueIndex('idx_unique_content_slug_personal')
      .on(table.slug, table.creatorId)
      .where(
        sql`${table.organizationId} IS NULL AND ${table.deletedAt} IS NULL`
      ),

    // CHECK constraints
    check(
      'check_content_status',
      sql`${table.status} IN ('draft', 'published', 'archived')`
    ),
    check(
      'check_content_type',
      sql`${table.contentType} IN ('video', 'audio', 'written')`
    ),
    check(
      'check_price_non_negative',
      sql`${table.priceCents} IS NULL OR ${table.priceCents} >= 0`
    ),
  ]
);

/**
 * Explicit tier → content grants (Codex-2hxff.91): the content twin of
 * `course_tier_access`. Each row names one tier that includes one content
 * item; a SET, not a ladder, so a dearer tier is never implied. Read only
 * behind `content.is_tier_gated` (the gate); ticks never open an ungated row.
 *
 * A join table with no `deleted_at`: writers replace rows by delete + insert in
 * one transaction (the accepted exception to soft deletes). The composite FKs
 * pin the content and the tier to the row's ONE organisation, so a cross-org
 * tick is impossible in the DB. Tier delete is SOFT, so its cascade never
 * fires: `TierService.deleteTier` deletes the ticks itself.
 */
export const contentTierAccess = pgTable(
  'content_tier_access',
  {
    contentId: uuid('content_id').notNull(),
    tierId: uuid('tier_id').notNull(),
    // The org BOTH the content and the tier belong to.
    organizationId: uuid('organization_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.contentId, table.tierId] }),
    // tier → content ids, index-only: the library arm, the copy and the
    // checklist all read this way.
    index('idx_content_tier_access_tier_content').on(
      table.tierId,
      table.contentId
    ),
    index('idx_content_tier_access_org_id').on(table.organizationId),
    foreignKey({
      columns: [table.contentId, table.organizationId],
      foreignColumns: [content.id, content.organizationId],
      name: 'fk_content_tier_access_content_org',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tierId, table.organizationId],
      foreignColumns: [subscriptionTiers.id, subscriptionTiers.organizationId],
      name: 'fk_content_tier_access_tier_org',
    }).onDelete('cascade'),
  ]
);

// Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  content: many(content),
  memberships: many(organizationMemberships),
}));

export const organizationMembershipsRelations = relations(
  organizationMemberships,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationMemberships.organizationId],
      references: [organizations.id],
    }),
    user: one(users, {
      fields: [organizationMemberships.userId],
      references: [users.id],
    }),
    inviter: one(users, {
      fields: [organizationMemberships.invitedBy],
      references: [users.id],
    }),
  })
);

export const mediaItemsRelations = relations(mediaItems, ({ one }) => ({
  creator: one(users, {
    fields: [mediaItems.creatorId],
    references: [users.id],
  }),
}));

export const contentRelations = relations(content, ({ one, many }) => ({
  tierAccess: many(contentTierAccess),
  creator: one(users, {
    fields: [content.creatorId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [content.organizationId],
    references: [organizations.id],
  }),
  mediaItem: one(mediaItems, {
    fields: [content.mediaItemId],
    references: [mediaItems.id],
  }),
}));

export const contentTierAccessRelations = relations(
  contentTierAccess,
  ({ one }) => ({
    content: one(content, {
      fields: [contentTierAccess.contentId],
      references: [content.id],
    }),
    tier: one(subscriptionTiers, {
      fields: [contentTierAccess.tierId],
      references: [subscriptionTiers.id],
    }),
  })
);

// Type exports
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrganizationMembership =
  typeof organizationMemberships.$inferSelect;
export type NewOrganizationMembership =
  typeof organizationMemberships.$inferInsert;
export type MediaItem = typeof mediaItems.$inferSelect;
/**
 * A media row as a response carries it: without the transcoder's raw detail
 * (Codex-l2c48) or the delete's file-purge bookkeeping (Codex-6sbn1).
 * MEDIA_ITEM_RESPONSE_COLUMNS, utils/media-item-columns.ts.
 */
export type ServedMediaItem = Omit<
  MediaItem,
  | 'transcodingError'
  | 'filesPurgeAfter'
  | 'filesPurgeStartedAt'
  | 'filesPurgedAt'
>;
export type NewMediaItem = typeof mediaItems.$inferInsert;
export type Content = typeof content.$inferSelect;
export type NewContent = typeof content.$inferInsert;
export type ContentTierAccess = typeof contentTierAccess.$inferSelect;
export type NewContentTierAccess = typeof contentTierAccess.$inferInsert;
