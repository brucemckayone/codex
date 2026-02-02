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

import { MEDIA_STATUS, PAGINATION } from '@codex/constants';
import {
  scopedNotDeleted,
  withCreatorScope,
  withPagination,
} from '@codex/database';
import { mediaItems } from '@codex/database/schema';
import { BaseService } from '@codex/service-errors';
import type { PaginatedListResponse } from '@codex/shared-types';
import type {
  CreateMediaItemInput,
  UpdateMediaItemInput,
} from '@codex/validation';
import {
  createMediaItemSchema,
  updateMediaItemSchema,
} from '@codex/validation';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { MediaNotFoundError, wrapError } from '../errors';
import type {
  MediaItem,
  MediaItemFilters,
  MediaItemWithRelations,
  PaginationParams,
} from '../types';

/**
 * Media Item Service Class
 *
 * Handles all media item-related business logic:
 * - Create media items (during upload)
 * - Update media metadata (after transcoding)
 * - Delete media items (soft delete)
 * - List media items with filters
 */
export class MediaItemService extends BaseService {
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
   * @returns Created media item
   */
  async create(
    input: CreateMediaItemInput,
    creatorId: string
  ): Promise<MediaItem> {
    // Validate input with Zod
    const validated = createMediaItemSchema.parse(input);

    try {
      const [newMediaItem] = await this.db
        .insert(mediaItems)
        .values({
          creatorId,
          title: validated.title,
          description: validated.description || null,
          mediaType: validated.mediaType,
          status: MEDIA_STATUS.UPLOADING, // Always start as uploading
          r2Key: validated.r2Key,
          fileSizeBytes: validated.fileSizeBytes,
          mimeType: validated.mimeType,
        })
        .returning();

      if (!newMediaItem) {
        throw new Error('Failed to create media item');
      }

      return newMediaItem;
    } catch (error) {
      throw wrapError(error, { creatorId, input: validated });
    }
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
      throw wrapError(error, { mediaItemId: id, creatorId });
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
      // Debug: Log actual error before wrapping
      console.error('[MediaItemService.update] Error:', error);
      throw wrapError(error, { mediaItemId: id, creatorId, input: validated });
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
      throw wrapError(error, { mediaItemId: id, creatorId });
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

      // Get items
      const items = await this.db.query.mediaItems.findMany({
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
      });

      // Get total count
      const countResult = await this.db
        .select({ total: count() })
        .from(mediaItems)
        .where(and(...whereConditions));

      const totalRecord = countResult[0];
      if (!totalRecord) {
        throw new Error('Failed to get media item count');
      }

      const { total } = totalRecord;

      const totalCount = Number(total);
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
      throw wrapError(error, { creatorId, filters, pagination });
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
