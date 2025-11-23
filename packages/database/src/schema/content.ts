import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Organizations table
 * Aligned with database-schema.md lines 256-281
 * Phase 1: Basic organization support
 */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull().unique(),
    description: text('description'),

    // Branding
    logoUrl: text('logo_url'),
    websiteUrl: text('website_url'),

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
  (table) => [index('idx_organizations_slug').on(table.slug)]
);

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

    // R2 Storage (in creator's bucket: codex-media-{creator_id}) // TODO: double check this is correct becuase it should be that we are 4 buckets and each has its own creator id subfolder within
    r2Key: varchar('r2_key', { length: 500 }).notNull(), // "originals/{media_id}/video.mp4"
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
    mimeType: varchar('mime_type', { length: 100 }),

    // Media Metadata
    durationSeconds: integer('duration_seconds'),
    width: integer('width'), // For video
    height: integer('height'), // For video

    // HLS Transcoding (Phase 1+)
    hlsMasterPlaylistKey: varchar('hls_master_playlist_key', { length: 500 }), // "hls/{media_id}/master.m3u8"
    thumbnailKey: varchar('thumbnail_key', { length: 500 }), // "thumbnails/{media_id}/thumb.jpg"

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
  },
  (table) => [
    index('idx_media_items_creator_id').on(table.creatorId),
    index('idx_media_items_status').on(table.creatorId, table.status),
    index('idx_media_items_type').on(table.creatorId, table.mediaType),

    // CHECK constraints
    check(
      'check_media_status',
      sql`${table.status} IN ('uploading', 'uploaded', 'transcoding', 'ready', 'failed')`
    ),
    check('check_media_type', sql`${table.mediaType} IN ('video', 'audio')`),
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

    // Organization (simplified for Phase 1)
    category: varchar('category', { length: 100 }), // Simple string category
    tags: jsonb('tags').$type<string[]>().default([]), // Array of tag strings

    // Access & Pricing
    visibility: varchar('visibility', { length: 50 })
      .default('purchased_only')
      .notNull(),
    // 'public' | 'private' | 'members_only' | 'purchased_only' (Phase 1: public, purchased_only)
    priceCents: integer('price_cents'), // NULL = free, INTEGER = price in cents (ACID-compliant)

    // Status
    status: varchar('status', { length: 50 }).default('draft').notNull(),
    // 'draft' | 'published' | 'archived'
    publishedAt: timestamp('published_at', { withTimezone: true }),

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

    // Partial unique indexes for slug uniqueness
    // Unique slug per organization (for organization content)
    uniqueIndex('idx_unique_content_slug_per_org')
      .on(table.slug, table.organizationId)
      .where(sql`${table.organizationId} IS NOT NULL`),

    // Unique slug per creator (for personal content)
    uniqueIndex('idx_unique_content_slug_personal')
      .on(table.slug, table.creatorId)
      .where(sql`${table.organizationId} IS NULL`),

    // CHECK constraints
    check(
      'check_content_status',
      sql`${table.status} IN ('draft', 'published', 'archived')`
    ),
    check(
      'check_content_visibility',
      sql`${table.visibility} IN ('public', 'private', 'members_only', 'purchased_only')`
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

export const contentRelations = relations(content, ({ one }) => ({
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

// Type exports
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrganizationMembership =
  typeof organizationMemberships.$inferSelect;
export type NewOrganizationMembership =
  typeof organizationMemberships.$inferInsert;
export type MediaItem = typeof mediaItems.$inferSelect;
export type NewMediaItem = typeof mediaItems.$inferInsert;
export type Content = typeof content.$inferSelect;
export type NewContent = typeof content.$inferInsert;
