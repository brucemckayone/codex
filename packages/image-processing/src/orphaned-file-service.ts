/**
 * Orphaned File Service
 *
 * Manages tracking and cleanup of orphaned R2 image files.
 * Works with OrphanedFileCleanupDO (Durable Object) for periodic batch cleanup.
 */

import type {
  OrphanedEntityType,
  OrphanedImageType,
  OrphanStatus,
} from '@codex/database';

import { and, eq, inArray, lt, schema, sql } from '@codex/database';
import { BaseService } from '@codex/service-errors';
import { pageIdOfPageImageKey } from './page-image-keys';

export interface RecordOrphanInput {
  r2Key: string;
  imageType: OrphanedImageType;
  entityId?: string;
  entityType?: OrphanedEntityType;
  fileSizeBytes?: number;
}

export interface OrphanedFileRecord {
  id: string;
  r2Key: string;
  imageType: OrphanedImageType;
  originalEntityId: string | null;
  originalEntityType: OrphanedEntityType | null;
  orphanedAt: Date;
  cleanupAttempts: number;
  lastAttemptAt: Date | null;
  status: OrphanStatus;
  errorMessage: string | null;
  fileSizeBytes: number | null;
}

export interface CleanupStats {
  processed: number;
  deleted: number;
  failed: number;
  remaining: number;
}

/**
 * Maximum cleanup attempts before marking as failed
 */
const MAX_CLEANUP_ATTEMPTS = 3;

/**
 * Default batch size for cleanup operations
 */
const DEFAULT_BATCH_SIZE = 50;

/**
 * How long a `page_image` orphan waits before the sweep may act on it.
 *
 * A page-image row is a CANDIDATE, not a verdict: it is written when an image
 * is uploaded and again when a save drops it, and the sweep deletes the object
 * only if no page references it by then ({@link
 * OrphanedFileService.isPageImageReferenced}). The wait keeps that check from
 * running while a reference is still on its way back — an undo in the editor,
 * or an edit to a PUBLISHED page, which autosave never writes and which
 * reaches the row only when the creator publishes it. A week of unused bytes
 * costs next to nothing; deleting an image a page is about to show costs the
 * creator their page.
 */
export const PAGE_IMAGE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export class OrphanedFileService extends BaseService {
  /**
   * Record an orphaned file for deferred cleanup
   *
   * Called when R2 cleanup fails after a database operation,
   * or when an entity is deleted and its images need cleanup.
   */
  async recordOrphanedFile(input: RecordOrphanInput): Promise<string> {
    const records = await this.db
      .insert(schema.orphanedImageFiles)
      .values({
        r2Key: input.r2Key,
        imageType: input.imageType,
        originalEntityId: input.entityId,
        originalEntityType: input.entityType,
        fileSizeBytes: input.fileSizeBytes,
        status: 'pending',
        orphanedAt: new Date(),
      })
      .returning();

    const record = records[0];
    if (!record) {
      throw new Error('Failed to insert orphaned file record');
    }

    this.obs.info('Orphaned file recorded', {
      orphanId: record.id,
      r2Key: input.r2Key,
      imageType: input.imageType,
      entityId: input.entityId,
      entityType: input.entityType,
    });

    return record.id;
  }

  /**
   * Record multiple orphaned files in a single transaction
   *
   * Used when deleting multiple variants (sm, md, lg) at once.
   */
  async recordOrphanedFiles(inputs: RecordOrphanInput[]): Promise<string[]> {
    if (inputs.length === 0) return [];

    const records = await this.db
      .insert(schema.orphanedImageFiles)
      .values(
        inputs.map((input) => ({
          r2Key: input.r2Key,
          imageType: input.imageType,
          originalEntityId: input.entityId,
          originalEntityType: input.entityType,
          fileSizeBytes: input.fileSizeBytes,
          status: 'pending' as const,
          orphanedAt: new Date(),
        }))
      )
      .returning();

    const ids = records.map((r) => r.id);

    this.obs.info('Multiple orphaned files recorded', {
      count: ids.length,
      r2Keys: inputs.map((i) => i.r2Key),
    });

    return ids;
  }

  /**
   * Get pending orphans for cleanup
   *
   * Orders by orphanedAt (oldest first) to ensure FIFO processing.
   * Only returns orphans with attempts < MAX_CLEANUP_ATTEMPTS, and a
   * `page_image` orphan only once {@link PAGE_IMAGE_GRACE_MS} has passed.
   */
  async getPendingOrphans(
    limit: number = DEFAULT_BATCH_SIZE,
    now: Date = new Date()
  ): Promise<OrphanedFileRecord[]> {
    const pageImagesDueBefore = new Date(now.getTime() - PAGE_IMAGE_GRACE_MS);
    const orphans = await this.db
      .select()
      .from(schema.orphanedImageFiles)
      .where(
        and(
          eq(schema.orphanedImageFiles.status, 'pending'),
          lt(schema.orphanedImageFiles.cleanupAttempts, MAX_CLEANUP_ATTEMPTS),
          // A `sql` fragment, not `or(...)`: drizzle types `or()` as
          // `SQL | undefined`, and `and()` drops an undefined argument
          // silently, which here would sweep page images with no wait.
          sql`(${schema.orphanedImageFiles.imageType} <> 'page_image' OR ${schema.orphanedImageFiles.orphanedAt} < ${pageImagesDueBefore})`
        )
      )
      .orderBy(schema.orphanedImageFiles.orphanedAt)
      .limit(limit);

    return orphans as OrphanedFileRecord[];
  }

  /**
   * Whether any landing page still references a page image — the check the
   * sweep makes before it deletes one, and the only authority on it.
   *
   * The save-time diff that queues a page image cannot be: undo re-adds a key
   * after the save that dropped it, a duplicated page renders its source's
   * keys, and two overlapping saves diff against the same old row. So the
   * question is asked again, of the rows as they are now, immediately before
   * the delete.
   *
   * Searches the pages of the org that owns the key's page (the page id is
   * part of the key), because that is where a legitimate reference can be:
   * the page itself, or a page duplicated from it. Soft-deleted pages count,
   * since a restore brings their images back. A key pasted into another org's
   * page does not keep the image alive, and never gets it deleted either:
   * only its own org's pages decide.
   *
   * @param baseKey - The base key a block stores (`ImageRef.key`), not an
   *   object key
   * @returns `true` when a page references it, and for a key whose page
   *   cannot be read from it — a key this service cannot place is kept
   */
  async isPageImageReferenced(baseKey: string): Promise<boolean> {
    const pageId = pageIdOfPageImageKey(baseKey);
    if (!pageId) return true;

    const owningOrg = this.db
      .select({ organizationId: schema.landingPages.organizationId })
      .from(schema.landingPages)
      .where(eq(schema.landingPages.id, pageId));

    const references = await this.db
      .select({ id: schema.landingPages.id })
      .from(schema.landingPages)
      .where(
        and(
          inArray(schema.landingPages.organizationId, owningOrg),
          sql`strpos(${schema.landingPages.sections}::text, ${baseKey}) > 0`
        )
      )
      .limit(1);

    return references.length > 0;
  }

  /**
   * Mark an orphan as successfully deleted
   */
  async markDeleted(id: string): Promise<void> {
    await this.db
      .update(schema.orphanedImageFiles)
      .set({
        status: 'deleted',
        lastAttemptAt: new Date(),
      })
      .where(eq(schema.orphanedImageFiles.id, id));

    this.obs.info('Orphaned file deleted', { orphanId: id });
  }

  /**
   * Record a failed cleanup attempt
   *
   * Increments attempt counter and records error message.
   * If max attempts reached, marks as 'failed' for manual review.
   */
  async recordFailedAttempt(id: string, error: string): Promise<void> {
    // Use atomic increment to prevent race conditions
    const updated = await this.db
      .update(schema.orphanedImageFiles)
      .set({
        cleanupAttempts: sql`${schema.orphanedImageFiles.cleanupAttempts} + 1`,
        lastAttemptAt: new Date(),
        errorMessage: error,
      })
      .where(eq(schema.orphanedImageFiles.id, id))
      .returning();

    const record = updated[0];

    // If we've hit max attempts, mark as failed
    if (record && record.cleanupAttempts >= MAX_CLEANUP_ATTEMPTS) {
      await this.db
        .update(schema.orphanedImageFiles)
        .set({ status: 'failed' })
        .where(eq(schema.orphanedImageFiles.id, id));

      this.obs.warn('Orphaned file cleanup failed permanently', {
        orphanId: id,
        attempts: record.cleanupAttempts,
        error,
      });
    } else {
      this.obs.warn('Orphaned file cleanup attempt failed', {
        orphanId: id,
        attempts: record?.cleanupAttempts ?? 0,
        error,
      });
    }
  }

  /**
   * Get cleanup statistics
   */
  async getStats(): Promise<CleanupStats> {
    const results = await this.db
      .select({
        pending: sql<number>`COUNT(*) FILTER (WHERE ${schema.orphanedImageFiles.status} = 'pending')`,
        deleted: sql<number>`COUNT(*) FILTER (WHERE ${schema.orphanedImageFiles.status} = 'deleted')`,
        failed: sql<number>`COUNT(*) FILTER (WHERE ${schema.orphanedImageFiles.status} = 'failed')`,
        retained: sql<number>`COUNT(*) FILTER (WHERE ${schema.orphanedImageFiles.status} = 'retained')`,
      })
      .from(schema.orphanedImageFiles);

    const stats = results[0] ?? {
      pending: 0,
      deleted: 0,
      failed: 0,
      retained: 0,
    };

    return {
      processed: Number(stats.deleted) + Number(stats.failed),
      deleted: Number(stats.deleted),
      failed: Number(stats.failed),
      remaining: Number(stats.pending),
    };
  }

  /**
   * Mark orphan as retained (keep for audit/investigation)
   */
  async markRetained(id: string, reason?: string): Promise<void> {
    await this.db
      .update(schema.orphanedImageFiles)
      .set({
        status: 'retained',
        errorMessage: reason ?? 'Marked for retention',
      })
      .where(eq(schema.orphanedImageFiles.id, id));

    this.obs.info('Orphaned file marked for retention', {
      orphanId: id,
      reason,
    });
  }

  /**
   * Get failed orphans for manual review
   */
  async getFailedOrphans(limit: number = 100): Promise<OrphanedFileRecord[]> {
    const orphans = await this.db
      .select()
      .from(schema.orphanedImageFiles)
      .where(eq(schema.orphanedImageFiles.status, 'failed'))
      .orderBy(schema.orphanedImageFiles.orphanedAt)
      .limit(limit);

    return orphans as OrphanedFileRecord[];
  }
}
