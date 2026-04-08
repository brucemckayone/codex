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
import { MEDIA_STATUS, MIME_TO_EXTENSION, PAGINATION } from '@codex/constants';
import {
  scopedNotDeleted,
  withCreatorScope,
  withPagination,
} from '@codex/database';
import { mediaItems } from '@codex/database/schema';
import {
  BaseService,
  BusinessLogicError,
  InternalServiceError,
  type ServiceConfig,
  ValidationError,
} from '@codex/service-errors';
import type { PaginatedListResponse } from '@codex/shared-types';
import { getOriginalKey, isValidR2Key } from '@codex/transcoding';
import type {
  CreateMediaItemInput,
  UpdateMediaItemInput,
} from '@codex/validation';
import {
  createMediaItemSchema,
  updateMediaItemSchema,
} from '@codex/validation';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { MediaNotFoundError } from '../errors';
import type {
  MediaItem,
  MediaItemFilters,
  MediaItemWithRelations,
  PaginationParams,
} from '../types';

export interface MediaItemServiceConfig extends ServiceConfig {
  /** R2Service with signing config for presigned upload URLs. Optional in dev. */
  r2?: R2Service;
}

/**
 * Media Item Service Class
 *
 * Handles all media item-related business logic:
 * - Create media items (during upload) with presigned upload URL
 * - Update media metadata (after transcoding)
 * - Delete media items (soft delete)
 * - List media items with filters
 *
 * Media items are creator-scoped: all R2 paths use {creatorId}/ prefix.
 */
export class MediaItemService extends BaseService {
  private readonly r2?: R2Service;

  constructor(config: MediaItemServiceConfig) {
    super(config);
    this.r2 = config.r2;
  }
  /**
   * Create new media item
   *
   * Security:
   * - Scoped to creator
   * - Validates R2 key format
   * - Starts with 'uploading' status
   *
   * @param input - Media item creation data
   * @param creatorId - ID of the creator (uploader)
   * @returns Created media item with optional presigned upload URL
   */
  async create(
    input: CreateMediaItemInput,
    creatorId: string
  ): Promise<MediaItem & { presignedUrl: string | null }> {
    const validated = createMediaItemSchema.parse(input);

    // Resolve file extension from MIME type using the validation schema's enum as SSOT.
    // Throws if MIME type is unknown — upstream validation should have caught this.
    const ext = MIME_TO_EXTENSION[validated.mimeType];
    if (!ext) {
      throw new ValidationError(
        `Unsupported MIME type '${validated.mimeType}' — no file extension mapping exists`
      );
    }

    try {
      const mediaId = crypto.randomUUID();

      // Generate R2 key server-side using SSOT path helper.
      // Media items are creator-scoped: {creatorId}/originals/{mediaId}/media.{ext}
      // If r2Key is provided (e.g. in tests), use it; otherwise generate from SSOT.
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

      return { ...newMediaItem, presignedUrl };
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
   * Update media item
   *
   * Security:
   * - Validates creator ownership before update
   * - Used by transcoding service to update status/metadata
   *
   * Common updates:
   * - Set status to 'transcoding', 'ready', or 'failed'
   * - Add HLS playlist key and thumbnail key
   * - Set duration, width, height metadata
   *
   * @param id - Media item ID
   * @param input - Partial update data
   * @param creatorId - Creator ID (for authorization)
   * @returns Updated media item
   * @throws {MediaNotFoundError} If media doesn't exist
   * @throws {ForbiddenError} If media doesn't belong to creator
   */
  async update(
    id: string,
    input: UpdateMediaItemInput,
    creatorId: string
  ): Promise<MediaItem> {
    // Validate input
    const validated = updateMediaItemSchema.parse(input);

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
            ...validated,
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
   * Soft delete media item
   *
   * Security:
   * - Sets deleted_at timestamp (soft delete)
   * - Preserves data for content references
   * - Scoped to creator ownership
   *
   * Note: Content referencing this media will still exist but cannot be published
   *
   * @param id - Media item ID
   * @param creatorId - Creator ID (for authorization)
   * @throws {MediaNotFoundError} If media doesn't exist
   */
  async delete(id: string, creatorId: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const existing = await tx.query.mediaItems.findFirst({
          where: and(
            eq(mediaItems.id, id),
            scopedNotDeleted(mediaItems, creatorId)
          ),
        });

        if (!existing) {
          throw new MediaNotFoundError(id);
        }

        await tx
          .update(mediaItems)
          .set({
            deletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(eq(mediaItems.id, id), withCreatorScope(mediaItems, creatorId))
          );
      });
    } catch (error) {
      if (error instanceof MediaNotFoundError) {
        throw error;
      }
      this.handleError(error, 'delete');
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
   * @returns Paginated media item list with metadata
   */
  async list(
    creatorId: string,
    filters: MediaItemFilters = {},
    pagination: PaginationParams = {
      page: 1,
      limit: PAGINATION.DEFAULT,
    }
  ): Promise<PaginatedListResponse<MediaItemWithRelations>> {
    try {
      const { limit, offset } = withPagination(pagination);

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

      // Run items + count queries concurrently (independent queries)
      const [items, countResult] = await Promise.all([
        this.db.query.mediaItems.findMany({
          where: and(...whereConditions),
          limit,
          offset,
          orderBy: [orderByClause],
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
        this.db
          .select({ total: count() })
          .from(mediaItems)
          .where(and(...whereConditions)),
      ]);

      const totalCount = Number(countResult[0]?.total ?? 0);
      const totalPages = Math.ceil(totalCount / limit);

      return {
        items,
        pagination: {
          page: pagination.page,
          limit,
          total: totalCount,
          totalPages,
        },
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
    return this.update(id, { status }, creatorId);
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
    return this.update(
      id,
      {
        status: MEDIA_STATUS.READY,
        hlsMasterPlaylistKey: metadata.hlsMasterPlaylistKey,
        thumbnailKey: metadata.thumbnailKey,
        durationSeconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        uploadedAt: new Date(),
      },
      creatorId
    );
  }
}
