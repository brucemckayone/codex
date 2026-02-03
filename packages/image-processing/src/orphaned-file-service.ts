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

import { and, eq, lt, schema, sql } from '@codex/database';
import { BaseService } from '@codex/service-errors';

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
   * Only returns orphans with attempts < MAX_CLEANUP_ATTEMPTS.
   */
  async getPendingOrphans(
    limit: number = DEFAULT_BATCH_SIZE
  ): Promise<OrphanedFileRecord[]> {
    const orphans = await this.db
      .select()
      .from(schema.orphanedImageFiles)
      .where(
        and(
          eq(schema.orphanedImageFiles.status, 'pending'),
          lt(schema.orphanedImageFiles.cleanupAttempts, MAX_CLEANUP_ATTEMPTS)
        )
      )
      .orderBy(schema.orphanedImageFiles.orphanedAt)
      .limit(limit);

    return orphans as OrphanedFileRecord[];
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
