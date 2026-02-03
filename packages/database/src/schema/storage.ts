import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Image types that can become orphaned
 * Aligned with ImageProcessingService usage
 */
export const ORPHANED_IMAGE_TYPES = [
  'avatar',
  'logo',
  'content_thumbnail',
  'transcoding_artifact',
] as const;

export type OrphanedImageType = (typeof ORPHANED_IMAGE_TYPES)[number];

/**
 * Entity types that own images
 */
export const ORPHANED_ENTITY_TYPES = [
  'user',
  'organization',
  'content',
  'media_item',
] as const;

export type OrphanedEntityType = (typeof ORPHANED_ENTITY_TYPES)[number];

/**
 * Orphan cleanup status values
 */
export const ORPHAN_STATUS_VALUES = [
  'pending', // Awaiting cleanup
  'deleted', // Successfully deleted from R2
  'failed', // Cleanup failed after max attempts
  'retained', // Manually marked to keep (e.g., audit purposes)
] as const;

export type OrphanStatus = (typeof ORPHAN_STATUS_VALUES)[number];

/**
 * Orphaned Image Files
 *
 * Tracks R2 files that failed cleanup and need deferred deletion.
 * Used by OrphanedFileCleanupDO (Durable Object) for periodic batch cleanup.
 *
 * Orphan scenarios:
 * 1. R2 cleanup fails after successful DB update (network error, R2 unavailable)
 * 2. Entity deleted but R2 cleanup failed
 * 3. DB error after partial R2 upload (rolled back but files remain)
 *
 * Cleanup strategy:
 * - Durable Object runs alarm every hour
 * - Processes up to 50 pending orphans per run
 * - Retries up to 3 times with exponential backoff
 * - After 3 failures, marks as 'failed' for manual review
 */
export const orphanedImageFiles = pgTable(
  'orphaned_image_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // R2 storage location
    r2Key: varchar('r2_key', { length: 500 }).notNull(),

    // Classification
    imageType: varchar('image_type', { length: 50 })
      .notNull()
      .$type<OrphanedImageType>(),
    originalEntityId: varchar('original_entity_id', { length: 255 }),
    originalEntityType: varchar('original_entity_type', {
      length: 50,
    }).$type<OrphanedEntityType | null>(),

    // Tracking
    orphanedAt: timestamp('orphaned_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    cleanupAttempts: integer('cleanup_attempts').default(0).notNull(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),

    // Status
    status: varchar('status', { length: 50 })
      .default('pending')
      .notNull()
      .$type<OrphanStatus>(),
    errorMessage: text('error_message'),

    // Metadata
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),

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
    // Primary query patterns
    index('idx_orphaned_files_status').on(table.status),
    index('idx_orphaned_files_orphaned_at').on(table.orphanedAt),
    index('idx_orphaned_files_type_status').on(table.imageType, table.status),

    // For cleanup job: find pending orphans ordered by age
    index('idx_orphaned_files_pending_cleanup').on(
      table.status,
      table.orphanedAt
    ),

    // CHECK constraints
    check(
      'check_image_type',
      sql`${table.imageType} IN ('avatar', 'logo', 'content_thumbnail', 'transcoding_artifact')`
    ),
    check(
      'check_entity_type',
      sql`${table.originalEntityType} IS NULL OR ${table.originalEntityType} IN ('user', 'organization', 'content', 'media_item')`
    ),
    check(
      'check_orphan_status',
      sql`${table.status} IN ('pending', 'deleted', 'failed', 'retained')`
    ),
    check(
      'check_cleanup_attempts',
      sql`${table.cleanupAttempts} >= 0 AND ${table.cleanupAttempts} <= 10`
    ),
  ]
);

// Type exports
export type OrphanedImageFile = typeof orphanedImageFiles.$inferSelect;
export type NewOrphanedImageFile = typeof orphanedImageFiles.$inferInsert;
