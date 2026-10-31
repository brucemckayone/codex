/**
 * Media Item Service
 *
 * Manages media items (uploaded videos/audio).
 * All operations are scoped to creator.
 *
 * Key Principles:
 * - NO `any` types - all types properly inferred from Drizzle
 * - Creator scoping on ALL queries
 * - Transaction safety for multi-step operations
 * - Proper error handling with custom error classes
 * - Soft deletes only (sets deleted_at)
 */

import type { R2Service } from '@codex/cloudflare-clients';
import {
  MEDIA_STATUS,
  MIME_TO_EXTENSION,
  PAGINATION,
  TRANSCODING_ERROR_CODES,
  TRANSCODING_ERROR_MAX_LENGTH,
} from '@codex/constants';
import {
  MEDIA_ITEM_RESPONSE_COLUMNS,
  messageForLog,
  paginatedQuery,
  scopedNotDeleted,
  withCreatorScope,
  withoutTranscodingDetail,
} from '@codex/database';
import { mediaItems } from '@codex/database/schema';
import {
  BaseService,
  BusinessLogicError,
  ConflictError,
  InternalServiceError,
  type ServiceConfig,
  ValidationError,
} from '@codex/service-errors';
import type { MediaUsage, PaginatedListResponse } from '@codex/shared-types';
import {
  getHlsPrefix,
  getOriginalKey,
  isValidR2Key,
  type MediaStatusPublisher,
  PATH_CONFIG,
  parseR2Key,
  publishMediaRemoved,
  publishMediaStatus,
} from '@codex/transcoding';
import type {
  CreateMediaItemInput,
  UpdateMediaItemInput,
} from '@codex/validation';
import {
  createMediaItemSchema,
  updateMediaItemSchema,
} from '@codex/validation';
import { and, asc, desc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { MediaNotFoundError } from '../errors';
import type {
  MediaItem,
  MediaItemFilters,
  MediaItemWithRelations,
  MediaListItem,
  PaginationParams,
  ServedMediaItem,
} from '../types';
import {
  assertMediaDeletable,
  countMediaUses,
  readMediaUses,
  summariseMediaUsage,
} from './media-usage';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a delete keeps the files (owner, Codex-6sbn1). */
const MEDIA_FILES_KEPT_MS = 30 * DAY_MS;

/** Due items one purge run takes; what's left waits a day. */
const MEDIA_FILES_PURGE_BATCH = 25;

/** What one {@link MediaItemService.purgeDueFiles} run did. Ids only. */
export interface MediaFilesPurgeReport {
  due: number;
  purged: number;
  skippedInUse: number;
  failed: number;
  objectsDeleted: number;
  durationMs: number;
}

/**
 * The MEDIA_BUCKET folders a media item's files live in: the original, the
 * HLS ladder (its 30-second preview is inside it), the poster and the
 * waveform.
 */
function mediaFilePrefixes(creatorId: string, mediaId: string): string[] {
  return [
    `${creatorId}/${PATH_CONFIG.ORIGINALS_FOLDER}/${mediaId}/`,
    getHlsPrefix(creatorId, mediaId),
    `${creatorId}/${PATH_CONFIG.THUMBNAILS_FOLDER}/${mediaId}/`,
    `${creatorId}/${PATH_CONFIG.WAVEFORMS_FOLDER}/${mediaId}/`,
  ];
}

/**
 * Delete every object under `prefix`, a listed page (up to 1,000 keys) per
 * call, and answer how many. R2 has no "delete folder", and an HLS folder is
 * hundreds of segments. Throws on any failure, so the purge gives its claim
 * back.
 */
async function deletePrefix(r2: R2Service, prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await r2.list({ prefix, cursor });
    const keys = page.objects.map((object) => object.key);
    if (keys.length > 0) {
      await r2.delete(keys);
      deleted += keys.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

/** The columns applyUpdate writes: the creator's two, or a lifecycle write's. */
type MediaRowUpdate = Partial<
  Pick<
    typeof mediaItems.$inferInsert,
    | 'title'
    | 'description'
    | 'status'
    | 'durationSeconds'
    | 'width'
    | 'height'
    | 'hlsMasterPlaylistKey'
    | 'thumbnailKey'
  >
>;

/**
 * A key the caller named is used only inside the caller's OWN originals
 * folder. The key is the file a presigned PUT and the upload fallback
 * overwrite, and the file transcoding reads: another creator's key would
 * overwrite their original, or copy it into this creator's library
 * (Codex-58h6c).
 */
function isOwnOriginalKey(r2Key: string, creatorId: string): boolean {
  const parsed = parseR2Key(r2Key);
  return (
    parsed?.creatorId === creatorId &&
    parsed.folder === PATH_CONFIG.ORIGINALS_FOLDER
  );
}

interface MediaItemServiceConfig extends ServiceConfig {
  /** R2Service with signing config for presigned upload URLs. Optional in dev. */
  r2?: R2Service;
  /**
   * Live status for the creator's studio tabs (Codex-l2c48.9): told after a
   * write returned its row. Absent: nothing is published.
   */
  mediaStatus?: MediaStatusPublisher;
}

/**
 * Media Item Service Class
 *
 * Handles all media item-related business logic:
 * - Create media items (during upload) with presigned upload URL
 * - Update media metadata (after transcoding)
 * - Where a media item is used, and the delete guard on it (Codex-6sbn1)
 * - Delete media items (soft delete; the files are kept 30 days)
 * - Restore a deleted item inside the 30 days (support), and the daily
 *   purge of the files after
 * - List media items with filters
 *
 * Media items are creator-scoped: all R2 paths use {creatorId}/ prefix.
 */
export class MediaItemService extends BaseService {
  private readonly r2?: R2Service;
  private readonly mediaStatus?: MediaStatusPublisher;

  constructor(config: MediaItemServiceConfig) {
    super(config);
    this.r2 = config.r2;
    this.mediaStatus = config.mediaStatus;
  }
  /**
   * Create new media item
   *
   * Security:
   * - Scoped to creator
   * - Validates R2 key format; a key the caller names must be in its own
   *   originals folder
   * - Starts with 'uploading' status
   *
   * @param input - Media item creation data
   * @param creatorId - ID of the creator (uploader)
   * @returns Created media item with optional presigned upload URL
   */
  async create(
    input: CreateMediaItemInput,
    creatorId: string
  ): Promise<ServedMediaItem & { presignedUrl: string | null }> {
    const validated = createMediaItemSchema.parse(input);

    // Resolve file extension from MIME type using the validation schema's enum as SSOT.
    // Throws if MIME type is unknown — upstream validation should have caught this.
    const ext = MIME_TO_EXTENSION[validated.mimeType];
    if (!ext) {
      throw new ValidationError(
        `Unsupported MIME type '${validated.mimeType}' — no file extension mapping exists`
      );
    }
    if (
      validated.r2Key !== undefined &&
      !isOwnOriginalKey(validated.r2Key, creatorId)
    ) {
      throw new ValidationError(
        'The storage key must be in your own originals folder'
      );
    }

    try {
      const mediaId = crypto.randomUUID();

      // Generate R2 key server-side using SSOT path helper.
      // Media items are creator-scoped: {creatorId}/originals/{mediaId}/media.{ext}
      // A key the caller named (tests do) was checked above to be its own.
      const r2Key =
        validated.r2Key ?? getOriginalKey(creatorId, mediaId, `media.${ext}`);

      // Validate generated key matches expected format (defense-in-depth)
      if (!isValidR2Key(r2Key)) {
        throw new ValidationError(
          `Generated r2Key '${r2Key}' failed validation`,
          { r2Key, creatorId, mediaId }
        );
      }

      const [newMediaItem] = await this.db
        .insert(mediaItems)
        .values({
          id: mediaId,
          creatorId,
          title: validated.title,
          description: validated.description || null,
          mediaType: validated.mediaType,
          status: MEDIA_STATUS.UPLOADING,
          r2Key,
          fileSizeBytes: validated.fileSizeBytes,
          mimeType: validated.mimeType,
        })
        .returning();

      if (!newMediaItem) {
        throw new InternalServiceError('Failed to create media item', {
          creatorId,
          mediaId,
        });
      }
      // The uploading tab reports its % against this row (owner's choice 2A).
      publishMediaStatus(this.mediaStatus, newMediaItem, this.obs);

      // Generate presigned upload URL if R2 signing is available.
      // Null in local dev (no S3 creds) — client uses fallback upload endpoint.
      let presignedUrl: string | null = null;
      if (this.r2 && newMediaItem.r2Key && newMediaItem.mimeType) {
        try {
          presignedUrl = await this.r2.generateSignedUploadUrl(
            newMediaItem.r2Key,
            newMediaItem.mimeType,
            3600
          );
        } catch (err) {
          // Log so signing config issues are visible — but don't fail the create
          this.obs.error('Failed to generate presigned upload URL', {
            r2Key: newMediaItem.r2Key,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return { ...withoutTranscodingDetail(newMediaItem), presignedUrl };
    } catch (error) {
      this.handleError(error, 'create');
    }
  }

  /**
   * Upload file data to R2 for a media item.
   *
   * Verifies creator ownership and that media is in 'uploading' status.
   * Stores the file at the media item's r2Key path (creator-scoped).
   *
   * Used as a fallback when presigned URLs are unavailable (local dev).
   * In production, the client PUTs directly to the presigned R2 URL.
   *
   * @param mediaId - Media item UUID
   * @param body - File data (ArrayBuffer or ReadableStream)
   * @param contentType - MIME type of the file
   * @param creatorId - Creator ID for authorization
   */
  async upload(
    mediaId: string,
    body: ArrayBuffer,
    contentType: string,
    creatorId: string
  ): Promise<{ success: true; r2Key: string }> {
    if (!this.r2) {
      throw new InternalServiceError(
        'R2 service not configured — cannot upload media files'
      );
    }

    const media = await this.get(mediaId, creatorId);
    if (!media) throw new MediaNotFoundError(mediaId);

    if (media.status !== MEDIA_STATUS.UPLOADING) {
      throw new BusinessLogicError(
        `Cannot upload: media status is '${media.status}'`,
        { mediaId, status: media.status }
      );
    }
    if (!media.r2Key) {
      throw new ValidationError('Media has no r2Key', { mediaId });
    }

    await this.r2.put(media.r2Key, body, undefined, { contentType });

    return { success: true, r2Key: media.r2Key };
  }

  /**
   * Get media item by ID
   *
   * Security:
   * - Scoped to creator (can only see own media)
   * - Excludes soft-deleted media
   * - Populates creator relation
   *
   * @param id - Media item ID
   * @param creatorId - Creator ID (for authorization)
   * @returns Media item with relations or null if not found
   */
  async get(
    id: string,
    creatorId: string
  ): Promise<MediaItemWithRelations | null> {
    try {
      const result = await this.db.query.mediaItems.findFirst({
        where: and(
          eq(mediaItems.id, id),
          scopedNotDeleted(mediaItems, creatorId)
        ),
        columns: MEDIA_ITEM_RESPONSE_COLUMNS,
        with: {
          creator: {
            columns: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      });

      return result || null;
    } catch (error) {
      this.handleError(error, 'get');
    }
  }

  /**
   * Update what a creator may edit: title and description (PATCH
   * /api/media/:id). Lifecycle, keys and dimensions are written only by the
   * upload and transcoding paths, whose guarded writes publish to the live
   * status object (Codex-l2c48.9).
   *
   * @param id - Media item ID
   * @param input - Partial update data
   * @param creatorId - Creator ID (for authorization)
   * @returns Updated media item
   * @throws {MediaNotFoundError} If media doesn't exist or isn't the creator's
   */
  async update(
    id: string,
    input: UpdateMediaItemInput,
    creatorId: string
  ): Promise<ServedMediaItem> {
    return withoutTranscodingDetail(
      await this.applyUpdate(id, updateMediaItemSchema.parse(input), creatorId)
    );
  }

  /** One scoped write of the given columns; the row it wrote. */
  private async applyUpdate(
    id: string,
    fields: MediaRowUpdate,
    creatorId: string
  ): Promise<MediaItem> {
    try {
      const result = await this.db.transaction(async (tx) => {
        // Verify media exists and belongs to creator
        const existing = await tx.query.mediaItems.findFirst({
          where: and(
            eq(mediaItems.id, id),
            scopedNotDeleted(mediaItems, creatorId)
          ),
        });

        if (!existing) {
          throw new MediaNotFoundError(id);
        }

        // Update media item
        const [updated] = await tx
          .update(mediaItems)
          .set({
            ...fields,
            updatedAt: new Date(),
          })
          .where(
            and(eq(mediaItems.id, id), withCreatorScope(mediaItems, creatorId))
          )
          .returning();

        if (!updated) {
          throw new MediaNotFoundError(id);
        }

        return updated;
      });

      if (!result) {
        throw new MediaNotFoundError(id);
      }

      return result;
    } catch (error) {
      if (error instanceof MediaNotFoundError) {
        throw error;
      }
      this.obs.error('Media item update failed', {
        mediaItemId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      this.handleError(error, 'update');
    }
  }

  /**
   * Where the item is used (GET /api/media/:id/usage, Codex-6sbn1): the list
   * the delete dialog and the library popover draw, naming only uses the
   * caller can already see. Never cached: it is the delete's guard.
   *
   * @throws {MediaNotFoundError} If media doesn't exist or isn't the creator's
   */
  async getUsage(id: string, creatorId: string): Promise<MediaUsage> {
    try {
      const [owned] = await this.db
        .select({ id: mediaItems.id })
        .from(mediaItems)
        .where(
          and(eq(mediaItems.id, id), scopedNotDeleted(mediaItems, creatorId))
        )
        .limit(1);
      if (!owned) throw new MediaNotFoundError(id);
      return await summariseMediaUsage(
        await readMediaUses(this.db, [id], creatorId),
        creatorId
      );
    } catch (error) {
      this.handleError(error, 'getUsage');
    }
  }

  /**
   * Soft delete a media item (Codex-6sbn1).
   *
   * Refused with 409 `MEDIA_IN_USE` while anything live uses it (published
   * or bought content, a published course, an org's intro video), and with
   * 409 `MEDIA_USAGE_CHANGED` when `usageFingerprint` (from {@link getUsage})
   * no longer describes its uses, or is missing while drafts use it. Drafts
   * keep their link to the deleted row: they show "media missing", can't
   * publish (`MEDIA_DELETED`), and a {@link restore} heals them.
   *
   * The check and the write are one transaction, the media row locked FOR
   * UPDATE first. An attach's foreign key check takes FOR KEY SHARE, which a
   * plain UPDATE doesn't conflict with, so without the lock an attach would
   * not be ordered against the delete. Each attach path re-reads the row
   * with a locking read, so one that waited on this lock finds it deleted.
   *
   * The files stay: `filesPurgeAfter` is set 30 days on, and media-api's
   * daily purge ({@link purgeDueFiles}) removes them after, unless something
   * live uses the item by then. Nothing here touches R2.
   *
   * @param usageFingerprint - `MediaUsage.fingerprint` the dialog showed
   * @returns How many drafts are left without their media
   * @throws {MediaNotFoundError} If media doesn't exist or isn't the creator's
   * @throws {MediaInUseError} If anything live uses it
   * @throws {MediaUsageChangedError} If its uses changed since the dialog read them
   */
  async delete(
    id: string,
    creatorId: string,
    usageFingerprint?: string
  ): Promise<{ drafts: number }> {
    try {
      const drafts = await this.db.transaction(async (tx) => {
        const [locked] = await tx
          .select({ id: mediaItems.id })
          .from(mediaItems)
          .where(
            and(eq(mediaItems.id, id), scopedNotDeleted(mediaItems, creatorId))
          )
          .for('update');
        if (!locked) throw new MediaNotFoundError(id);

        const uses = await readMediaUses(tx, [id], creatorId);
        await assertMediaDeletable(uses, usageFingerprint);

        const deletedAt = new Date();
        await tx
          .update(mediaItems)
          .set({
            deletedAt,
            filesPurgeAfter: new Date(
              deletedAt.getTime() + MEDIA_FILES_KEPT_MS
            ),
            updatedAt: deletedAt,
          })
          .where(
            and(eq(mediaItems.id, id), withCreatorScope(mediaItems, creatorId))
          );
        return uses.length;
      });
      // After commit: a rolled-back delete must not vanish from the studio.
      publishMediaRemoved(this.mediaStatus, id, creatorId, this.obs);
      return { drafts };
    } catch (error) {
      this.handleError(error, 'delete');
    }
  }

  /**
   * Undo a delete inside the 30 days (support only: POST
   * /api/admin/media/:id/restore). One conditional update, so it and the
   * purge's claim can't both win. Drafts heal themselves: their link was
   * never cleared. The tile comes back in the creator's open Studio tabs.
   *
   * @throws {MediaNotFoundError} If no media item has this id
   * @throws {ConflictError} If it isn't deleted, or its files are gone: the
   *   purge has claimed it, or it was deleted before files were kept
   */
  async restore(id: string): Promise<ServedMediaItem> {
    try {
      const [restored] = await this.db
        .update(mediaItems)
        .set({ deletedAt: null, filesPurgeAfter: null, updatedAt: new Date() })
        .where(
          and(
            eq(mediaItems.id, id),
            isNotNull(mediaItems.deletedAt),
            isNotNull(mediaItems.filesPurgeAfter),
            isNull(mediaItems.filesPurgedAt)
          )
        )
        .returning();
      if (restored) {
        publishMediaStatus(this.mediaStatus, restored, this.obs);
        this.obs.info('media.restored', { mediaItemId: id });
        return withoutTranscodingDetail(restored);
      }

      const [row] = await this.db
        .select({ deletedAt: mediaItems.deletedAt })
        .from(mediaItems)
        .where(eq(mediaItems.id, id))
        .limit(1);
      if (!row) throw new MediaNotFoundError(id);
      throw new ConflictError(
        row.deletedAt
          ? 'This media item can no longer be restored: its files are gone.'
          : 'This media item is not deleted.',
        {
          mediaItemId: id,
          reason: row.deletedAt ? 'FILES_GONE' : 'NOT_DELETED',
        }
      );
    } catch (error) {
      this.handleError(error, 'restore');
    }
  }

  /**
   * Remove the files of deleted items whose 30 days are up (media-api's
   * hourly cron, at 03:00 UTC only). NEVER throws: a failure is logged and
   * the item tried again a day later.
   *
   * Per due item, oldest first, until `deadline`:
   * 1. the usage lookup: anything live uses it, skip and log at error level
   *    (the safety net: a race nobody thought of can't stop a published film
   *    playing, and support can restore the item);
   * 2. the claim, a conditional update stamping `filesPurgedAt` (zero rows:
   *    restored meanwhile, skip). From here a restore is refused;
   * 3. list and delete each of its prefixes in MEDIA_BUCKET;
   * 4. on any failure, give the claim back, due again in a day.
   *
   * Idempotent: the claim is conditional, and an absent key or an empty
   * prefix is not an error. A crash between the claim and the last delete
   * leaves objects behind a row marked purged, and no `media.files_purged`
   * line for it.
   */
  async purgeDueFiles(options: {
    deadline: number;
  }): Promise<MediaFilesPurgeReport> {
    const startedAt = Date.now();
    const report: MediaFilesPurgeReport = {
      due: 0,
      purged: 0,
      skippedInUse: 0,
      failed: 0,
      objectsDeleted: 0,
      durationMs: 0,
    };
    const r2 = this.r2;
    if (!r2) {
      this.obs.error('media.files_purge_unavailable', {
        reason: 'no media bucket',
      });
      return report;
    }

    try {
      const due = await this.db
        .select({ id: mediaItems.id, creatorId: mediaItems.creatorId })
        .from(mediaItems)
        .where(
          and(
            isNotNull(mediaItems.deletedAt),
            isNull(mediaItems.filesPurgedAt),
            isNotNull(mediaItems.filesPurgeAfter),
            lte(mediaItems.filesPurgeAfter, new Date())
          )
        )
        .orderBy(asc(mediaItems.filesPurgeAfter))
        .limit(MEDIA_FILES_PURGE_BATCH);
      report.due = due.length;

      for (const item of due) {
        if (Date.now() >= options.deadline) break;

        const counts = await countMediaUses(this.db, [item.id]);
        const live = counts.get(item.id)?.live ?? 0;
        if (live > 0) {
          report.skippedInUse++;
          this.obs.error('media.files_purge_skipped_in_use', {
            mediaItemId: item.id,
            live,
          });
          continue;
        }

        const [claimed] = await this.db
          .update(mediaItems)
          .set({ filesPurgedAt: new Date() })
          .where(
            and(
              eq(mediaItems.id, item.id),
              isNotNull(mediaItems.deletedAt),
              isNull(mediaItems.filesPurgedAt)
            )
          )
          .returning();
        if (!claimed) continue;

        let prefix = '';
        try {
          let objects = 0;
          for (prefix of mediaFilePrefixes(item.creatorId, item.id)) {
            objects += await deletePrefix(r2, prefix);
          }
          report.purged++;
          report.objectsDeleted += objects;
          this.obs.info('media.files_purged', {
            mediaItemId: item.id,
            objects,
          });
        } catch (error) {
          report.failed++;
          this.obs.warn('media.files_purge_failed', {
            mediaItemId: item.id,
            prefix,
            error: messageForLog(error),
          });
          await this.releasePurgeClaim(item.id);
        }
      }
    } catch (error) {
      this.obs.error('media.files_purge_run_failed', {
        error: messageForLog(error),
      });
    }

    report.durationMs = Date.now() - startedAt;
    this.obs.info('media.files_purge_run', { ...report });
    return report;
  }

  /** Give a failed purge's claim back: due again in a day. Never throws. */
  private async releasePurgeClaim(id: string): Promise<void> {
    try {
      await this.db
        .update(mediaItems)
        .set({
          filesPurgedAt: null,
          filesPurgeAfter: new Date(Date.now() + DAY_MS),
        })
        .where(eq(mediaItems.id, id));
    } catch (error) {
      this.obs.error('media.files_purge_claim_not_released', {
        mediaItemId: id,
        error: messageForLog(error),
      });
    }
  }

  /**
   * List media items with filtering and pagination
   *
   * Security:
   * - Scoped to creator (only shows own media)
   * - Excludes soft-deleted media
   *
   * Features:
   * - Pagination (page, limit)
   * - Filtering (status, mediaType)
   * - Sorting (by createdAt, uploadedAt, title)
   *
   * @param creatorId - Creator ID (for authorization)
   * @param filters - Query filters
   * @param pagination - Pagination parameters
   * - Each item's `usage`: how many places use it, how many of them live
   *   (the library chip, Codex-6sbn1). One statement for the page, never
   *   one per item.
   *
   * @returns Paginated media item list with metadata
   */
  async list(
    creatorId: string,
    filters: MediaItemFilters = {},
    pagination: PaginationParams = {
      page: 1,
      limit: PAGINATION.DEFAULT,
    }
  ): Promise<PaginatedListResponse<MediaListItem>> {
    try {
      // Build WHERE conditions
      const whereConditions = [scopedNotDeleted(mediaItems, creatorId)];

      // Add filters
      if (filters.status) {
        whereConditions.push(eq(mediaItems.status, filters.status));
      }
      if (filters.mediaType) {
        whereConditions.push(eq(mediaItems.mediaType, filters.mediaType));
      }

      // Determine sort column and order
      const sortColumn = filters.sortBy || 'createdAt';
      const sortOrder = filters.sortOrder || 'desc';
      const orderByClause =
        sortOrder === 'desc'
          ? desc(mediaItems[sortColumn])
          : asc(mediaItems[sortColumn]);

      const where = and(...whereConditions);
      const page = await paginatedQuery({
        page: pagination.page,
        limit: pagination.limit,
        fetchItems: (limit, offset) =>
          this.db.query.mediaItems.findMany({
            where,
            limit,
            offset,
            orderBy: [orderByClause],
            columns: MEDIA_ITEM_RESPONSE_COLUMNS,
            with: {
              creator: {
                columns: {
                  id: true,
                  email: true,
                  name: true,
                },
              },
            },
          }),
        countQuery: { db: this.db, table: mediaItems, where },
      });
      const usage = await countMediaUses(
        this.db,
        page.items.map((item) => item.id)
      );
      return {
        ...page,
        items: page.items.map((item) => ({
          ...item,
          usage: usage.get(item.id) ?? { total: 0, live: 0 },
        })),
      };
    } catch (error) {
      this.handleError(error, 'list');
    }
  }

  /**
   * Update media status
   *
   * Convenience method for transcoding service to update status.
   * Common flow:
   * - 'uploading' -> 'uploaded' (after S3 upload complete)
   * - 'uploaded' -> 'transcoding' (transcoding started)
   * - 'transcoding' -> 'ready' (transcoding complete)
   * - 'transcoding' -> 'failed' (transcoding failed)
   *
   * @param id - Media item ID
   * @param status - New status
   * @param creatorId - Creator ID (for authorization)
   * @returns Updated media item
   */
  async updateStatus(
    id: string,
    status:
      | typeof MEDIA_STATUS.UPLOADING
      | typeof MEDIA_STATUS.UPLOADED
      | typeof MEDIA_STATUS.TRANSCODING
      | typeof MEDIA_STATUS.READY
      | typeof MEDIA_STATUS.FAILED,
    creatorId: string
  ): Promise<MediaItem> {
    // State transitions are enforced by:
    // 1. DB CHECK constraint (status_ready_requires_keys) for the critical ready path
    // 2. TranscodingService atomic WHERE (eq(status, 'transcoding')) for webhook updates
    // 3. upload-complete handler checking current status before calling this
    // No extra DB roundtrip here — avoids Neon proxy hang in workerd.
    const updated = await this.applyUpdate(id, { status }, creatorId);
    publishMediaStatus(this.mediaStatus, updated, this.obs);
    return updated;
  }

  /**
   * Record the uploading tab's own measurement of the file's runtime, so the
   * runtime badge shows before transcoding completes. Only into an empty
   * column, in the same statement: the completion webhook's figure, measured
   * off the transcoded output, is the better authority and is never
   * overwritten, even by an upload-complete re-POST racing it.
   *
   * Advisory, so it never throws: a badge must not cost the upload its
   * `uploaded` step (upload-complete calls this first). A failure is logged.
   */
  async recordClientDuration(
    id: string,
    creatorId: string,
    durationSeconds: number
  ): Promise<void> {
    try {
      await this.db
        .update(mediaItems)
        .set({ durationSeconds, updatedAt: new Date() })
        .where(
          and(
            eq(mediaItems.id, id),
            scopedNotDeleted(mediaItems, creatorId),
            isNull(mediaItems.durationSeconds)
          )
        );
    } catch (error) {
      this.obs.error('media.client_duration_not_recorded', {
        mediaId: id,
        error: messageForLog(error),
      });
    }
  }

  /**
   * Record that the upload finished: `uploading` -> `uploaded`, stamping
   * `uploaded_at`. The maintenance cron gives up on an upload 24 h after that
   * stamp, so it must be the time the file arrived.
   *
   * Guarded on `uploading`: upload-complete is idempotent (a re-POST
   * re-triggers transcoding), and a repeat must not move the stamp.
   */
  async markUploaded(id: string, creatorId: string): Promise<void> {
    try {
      const [uploaded] = await this.db
        .update(mediaItems)
        .set({
          status: MEDIA_STATUS.UPLOADED,
          uploadedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mediaItems.id, id),
            scopedNotDeleted(mediaItems, creatorId),
            eq(mediaItems.status, MEDIA_STATUS.UPLOADING)
          )
        )
        .returning();
      if (uploaded) publishMediaStatus(this.mediaStatus, uploaded, this.obs);
    } catch (error) {
      this.handleError(error, 'markUploaded');
    }
  }

  /**
   * Mark media as ready with transcoding metadata
   *
   * Called by transcoding service when HLS generation is complete.
   *
   * @param id - Media item ID
   * @param metadata - Transcoding metadata (HLS playlist, thumbnail, dimensions, duration)
   * @param creatorId - Creator ID (for authorization)
   * @returns Updated media item
   */
  async markAsReady(
    id: string,
    metadata: {
      hlsMasterPlaylistKey: string;
      thumbnailKey: string;
      durationSeconds: number;
      width?: number;
      height?: number;
    },
    creatorId: string
  ): Promise<MediaItem> {
    const ready = await this.applyUpdate(
      id,
      {
        status: MEDIA_STATUS.READY,
        hlsMasterPlaylistKey: metadata.hlsMasterPlaylistKey,
        thumbnailKey: metadata.thumbnailKey,
        durationSeconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
      },
      creatorId
    );
    publishMediaStatus(this.mediaStatus, ready, this.obs);
    return ready;
  }

  /**
   * Record that triggering transcoding failed.
   *
   * The upload-complete handler makes the media-api transcode call in the
   * background (ctx.background) and returns immediately, so a failed hop
   * (media-api unreachable or down, worker auth refusing it) would otherwise
   * be invisible — the media row sits in 'uploaded' with no signal. Persisting the error makes it diagnosable: the row records
   * `transcodingError` (for the logs and the owner, never served; the studio
   * shows the sentence for the code), and the row stays in 'uploaded' so
   * re-POSTing /upload-complete re-dispatches (the existing idempotent recovery
   * path). The code TRANSCODER_UNAVAILABLE marks the row as waiting, so the
   * maintenance cron re-dispatches it too. The transcoding service's claim
   * flips status → 'transcoding' and clears both fields.
   *
   * Guarded on 'uploaded': when media-api answered late, after it had already
   * claimed the row, this must not stamp an error on a running transcode.
   *
   * A single scoped UPDATE: it runs after the response, and ctx.background
   * holds the registry's db cleanup off until it settles.
   */
  async recordTranscodingTriggerFailure(
    id: string,
    creatorId: string,
    error: string
  ): Promise<void> {
    const [waiting] = await this.db
      .update(mediaItems)
      .set({
        transcodingError: error.slice(0, TRANSCODING_ERROR_MAX_LENGTH),
        transcodingErrorCode: TRANSCODING_ERROR_CODES.TRANSCODER_UNAVAILABLE,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaItems.id, id),
          scopedNotDeleted(mediaItems, creatorId),
          eq(mediaItems.status, MEDIA_STATUS.UPLOADED)
        )
      )
      .returning();
    // A waiting row: the status object retries it within minutes.
    if (waiting) publishMediaStatus(this.mediaStatus, waiting, this.obs);
  }
}
