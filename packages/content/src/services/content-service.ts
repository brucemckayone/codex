/**
 * Content Service
 *
 * Manages content creation, publishing, and lifecycle.
 * All operations are scoped to creator/organization.
 *
 * Key Principles:
 * - NO `any` types - all types properly inferred from Drizzle
 * - Organization scoping on ALL queries
 * - Transaction safety for multi-step operations
 * - Proper error handling with custom error classes
 * - Soft deletes only (sets deleted_at)
 */

import type { R2Bucket } from '@cloudflare/workers-types';
import { type CachePurgeClient, R2Service } from '@codex/cloudflare-clients';
import {
  CONTENT_STATUS,
  CONTENT_TYPES,
  MEDIA_STATUS,
  MEDIA_TYPES,
  PAGINATION,
  VISIBILITY,
} from '@codex/constants';
import {
  isUniqueViolation,
  scopedNotDeleted,
  withCreatorScope,
  withPagination,
} from '@codex/database';
import { content, mediaItems } from '@codex/database/schema';
import {
  type ImageProcessingResult,
  ImageProcessingService,
} from '@codex/image-processing';
import { BaseService } from '@codex/service-errors';
import type { PaginatedListResponse } from '@codex/shared-types';
import type { CreateContentInput, UpdateContentInput } from '@codex/validation';
import { createContentSchema, updateContentSchema } from '@codex/validation';
import { and, asc, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import {
  BusinessLogicError,
  ContentNotFoundError,
  ContentTypeMismatchError,
  MediaNotFoundError,
  MediaNotReadyError,
  SlugConflictError,
  wrapError,
} from '../errors';
import type {
  Content,
  ContentFilters,
  ContentWithRelations,
  DatabaseTransaction,
  PaginationParams,
} from '../types';

/**
 * Content Service Class
 *
 * Handles all content-related business logic:
 * - Create content with media validation
 * - Update content metadata
 * - Publish/unpublish content
 * - Delete content (soft delete)
 * - List content with filters
 */
export class ContentService extends BaseService {
  private cachePurge?: CachePurgeClient;
  private webAppUrl?: string;

  setCachePurge(client: CachePurgeClient, webAppUrl: string): void {
    if (!webAppUrl) {
      throw new Error('webAppUrl must be a non-empty string');
    }
    this.cachePurge = client;
    this.webAppUrl = webAppUrl;
  }

  /**
   * Purge cached content pages by slug.
   * Awaited to ensure completion (critical for takedowns/unpublish).
   * Errors are logged but not rethrown to avoid failing the main operation.
   */
  private async purgeContentCache(slug: string): Promise<void> {
    if (!this.cachePurge || !slug) return;
    try {
      await this.cachePurge.purgeByUrls([`${this.webAppUrl}/content/${slug}`]);
    } catch (error) {
      console.error('Cache purge failed:', error);
    }
  }

  /**
   * Create new content
   *
   * Security:
   * - Validates media item exists and belongs to creator
   * - Validates content type matches media type
   * - Enforces organization scoping
   * - Prevents slug conflicts
   *
   * @param input - Content creation data (validated by Zod)
   * @param creatorId - ID of the creator
   * @returns Created content
   * @throws {MediaNotFoundError} If media item doesn't exist or doesn't belong to creator
   * @throws {MediaNotReadyError} If media item is not in 'ready' status
   * @throws {ContentTypeMismatchError} If content type doesn't match media type
   * @throws {SlugConflictError} If slug already exists for organization
   */
  async create(input: CreateContentInput, creatorId: string): Promise<Content> {
    // Step 1: Validate input with Zod schema
    const validated = createContentSchema.parse(input);

    try {
      // Step 2: Use transaction for atomicity
      const result = await this.db.transaction(async (tx) => {
        // Step 3: Validate media item (if provided)
        // Note: For draft creation, we don't require media to be ready
        // The ready check happens during publishing
        if (validated.mediaItemId) {
          await this.validateMediaItem(
            tx as DatabaseTransaction,
            validated.mediaItemId,
            creatorId,
            validated.contentType as
              | typeof CONTENT_TYPES.VIDEO
              | typeof CONTENT_TYPES.AUDIO,
            false // requireReady = false for draft creation
          );
        }

        // Step 4: Create content record
        const [newContent] = await tx
          .insert(content)
          .values({
            creatorId,
            organizationId: validated.organizationId || null,
            mediaItemId: validated.mediaItemId || null,
            title: validated.title,
            slug: validated.slug,
            description: validated.description || null,
            contentType: validated.contentType,
            contentBody: validated.contentBody || null,
            category: validated.category || null,
            tags: validated.tags || [],
            thumbnailUrl: validated.thumbnailUrl || null,
            visibility: validated.visibility || VISIBILITY.PURCHASED_ONLY,
            priceCents: validated.priceCents ?? null,
            status: CONTENT_STATUS.DRAFT, // Always start as draft
            viewCount: 0,
            purchaseCount: 0,
          })
          .returning();

        if (!newContent) {
          throw new Error('Failed to create content');
        }

        return newContent;
      });

      if (!result) {
        throw new Error('Failed to create content');
      }

      return result;
    } catch (error) {
      // Handle unique constraint violations (slug conflicts)
      if (isUniqueViolation(error)) {
        throw new SlugConflictError(validated.slug);
      }
      throw wrapError(error, { creatorId, input: validated });
    }
  }

  /**
   * Get content by ID
   *
   * Security:
   * - Scoped to creator (can only see own content)
   * - Excludes soft-deleted content
   * - Populates relations (mediaItem, organization, creator)
   *
   * @param id - Content ID
   * @param creatorId - Creator ID (for authorization)
   * @returns Content with relations or null if not found
   */
  async get(
    id: string,
    creatorId: string
  ): Promise<ContentWithRelations | null> {
    try {
      const result = await this.db.query.content.findFirst({
        where: and(eq(content.id, id), scopedNotDeleted(content, creatorId)),
        with: {
          mediaItem: true,
          organization: true,
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
      throw wrapError(error, { contentId: id, creatorId });
    }
  }

  /**
   * Update content
   *
   * Security:
   * - Validates creator ownership before update
   * - Prevents changing mediaItemId (immutable after creation)
   * - Maintains organization scoping
   *
   * @param id - Content ID
   * @param input - Partial update data
   * @param creatorId - Creator ID (for authorization)
   * @returns Updated content
   * @throws {ContentNotFoundError} If content doesn't exist
   * @throws {ForbiddenError} If content doesn't belong to creator
   */
  async update(
    id: string,
    input: UpdateContentInput,
    creatorId: string
  ): Promise<Content> {
    // Validate input
    const validated = updateContentSchema.parse(input);

    try {
      const result = await this.db.transaction(async (tx) => {
        // Verify content exists and belongs to creator
        const existing = await tx.query.content.findFirst({
          where: and(eq(content.id, id), scopedNotDeleted(content, creatorId)),
        });

        if (!existing) {
          throw new ContentNotFoundError(id);
        }

        // Update content
        const [updated] = await tx
          .update(content)
          .set({
            ...validated,
            updatedAt: new Date(),
          })
          .where(and(eq(content.id, id), withCreatorScope(content, creatorId)))
          .returning();

        if (!updated) {
          throw new ContentNotFoundError(id);
        }

        return updated;
      });

      if (!result) {
        throw new ContentNotFoundError(id);
      }

      return result;
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw error;
      }
      throw wrapError(error, { contentId: id, creatorId, input: validated });
    }
  }

  /**
   * Upload and process content thumbnail
   *
   * Security:
   * - Validates creator ownership
   * - Validates image file (size, type) via ImageProcessingService
   * - ImageProcessingService updates content record with thumbnail URL
   *
   * @param id - Content ID
   * @param creatorId - Creator ID (for authorization)
   * @param file - Image file to upload
   * @param r2 - R2 Bucket instance
   * @param r2PublicUrlBase - Public CDN base URL (e.g., https://cdn.revelations.studio)
   * @returns Result containing upload URL and metadata
   * @throws {ContentNotFoundError} If content doesn't exist
   */
  async uploadThumbnail(
    id: string,
    creatorId: string,
    file: File,
    r2: R2Bucket,
    r2PublicUrlBase: string
  ): Promise<ImageProcessingResult> {
    const existing = await this.db.query.content.findFirst({
      where: and(eq(content.id, id), scopedNotDeleted(content, creatorId)),
    });

    if (!existing) {
      throw new ContentNotFoundError(id);
    }

    // Create R2Service from R2 bucket
    const r2Service = new R2Service(r2);

    // Create image processing service with all required config
    const imageService = new ImageProcessingService({
      db: this.db,
      environment: this.environment,
      r2Service,
      r2PublicUrlBase,
    });

    // Process the thumbnail (service handles validation, upload, and DB update)
    const result = await imageService.processContentThumbnail(
      id,
      creatorId,
      file
    );

    return result;
  }

  /**
   * Publish content
   *
   * Business Logic:
   * - Sets status to 'published'
   * - Sets publishedAt timestamp
   * - Validates content is ready (has media if video/audio)
   * - Idempotent (returns success if already published)
   *
   * @param id - Content ID
   * @param creatorId - Creator ID (for authorization)
   * @returns Published content
   * @throws {ContentNotFoundError} If content doesn't exist
   * @throws {BusinessLogicError} If content is not ready to publish
   */
  async publish(id: string, creatorId: string): Promise<Content> {
    try {
      const result = await this.db.transaction(async (tx) => {
        // Get content with media item
        const existing = await tx.query.content.findFirst({
          where: and(eq(content.id, id), scopedNotDeleted(content, creatorId)),
          with: {
            mediaItem: true,
          },
        });

        if (!existing) {
          throw new ContentNotFoundError(id);
        }

        // Already published - idempotent
        if (existing.status === CONTENT_STATUS.PUBLISHED) {
          return existing;
        }

        // Validate content is ready to publish
        if (
          [CONTENT_TYPES.VIDEO, CONTENT_TYPES.AUDIO].includes(
            existing.contentType as
              | typeof CONTENT_TYPES.VIDEO
              | typeof CONTENT_TYPES.AUDIO
          )
        ) {
          if (!existing.mediaItem) {
            throw new BusinessLogicError(
              'Cannot publish content without media',
              {
                contentId: id,
                contentType: existing.contentType,
              }
            );
          }
          if (existing.mediaItem.status !== MEDIA_STATUS.READY) {
            throw new MediaNotReadyError(existing.mediaItem.id);
          }
        }

        // Publish content
        const [published] = await tx
          .update(content)
          .set({
            status: CONTENT_STATUS.PUBLISHED,
            publishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(content.id, id), withCreatorScope(content, creatorId)))
          .returning();

        if (!published) {
          throw new ContentNotFoundError(id);
        }

        return published;
      });

      if (!result) {
        throw new ContentNotFoundError(id);
      }

      // Purge cached content pages after publish
      await this.purgeContentCache(result.slug);

      return result;
    } catch (error) {
      if (
        error instanceof ContentNotFoundError ||
        error instanceof BusinessLogicError
      ) {
        throw error;
      }
      throw wrapError(error, { contentId: id, creatorId });
    }
  }

  /**
   * Unpublish content
   *
   * Business Logic:
   * - Sets status back to 'draft'
   * - Keeps publishedAt timestamp (for history)
   *
   * @param id - Content ID
   * @param creatorId - Creator ID (for authorization)
   * @returns Unpublished content
   * @throws {ContentNotFoundError} If content doesn't exist
   */
  async unpublish(id: string, creatorId: string): Promise<Content> {
    try {
      const result = await this.db.transaction(async (tx) => {
        const existing = await tx.query.content.findFirst({
          where: and(eq(content.id, id), scopedNotDeleted(content, creatorId)),
        });

        if (!existing) {
          throw new ContentNotFoundError(id);
        }

        const [unpublished] = await tx
          .update(content)
          .set({
            status: CONTENT_STATUS.DRAFT,
            updatedAt: new Date(),
          })
          .where(and(eq(content.id, id), withCreatorScope(content, creatorId)))
          .returning();

        if (!unpublished) {
          throw new ContentNotFoundError(id);
        }

        return unpublished;
      });

      // Purge cached content pages after unpublish (critical for takedowns)
      await this.purgeContentCache(result.slug);

      return result;
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw error;
      }
      throw wrapError(error, { contentId: id, creatorId });
    }
  }

  /**
   * Soft delete content
   *
   * Security:
   * - Sets deleted_at timestamp (soft delete)
   * - Preserves data for purchase history/analytics
   * - Scoped to creator ownership
   *
   * @param id - Content ID
   * @param creatorId - Creator ID (for authorization)
   * @throws {ContentNotFoundError} If content doesn't exist
   */
  async delete(id: string, creatorId: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const existing = await tx.query.content.findFirst({
          where: and(eq(content.id, id), scopedNotDeleted(content, creatorId)),
        });

        if (!existing) {
          throw new ContentNotFoundError(id);
        }

        await tx
          .update(content)
          .set({
            deletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(content.id, id), withCreatorScope(content, creatorId)));
      });
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw error;
      }
      throw wrapError(error, { contentId: id, creatorId });
    }
  }

  /**
   * List content with filtering and pagination
   *
   * Security:
   * - Scoped to creator (only shows own content)
   * - Excludes soft-deleted content
   * - Supports organization filtering
   *
   * Features:
   * - Pagination (page, limit)
   * - Filtering (status, type, visibility, category, organization)
   * - Search (title, description)
   * - Sorting (by various fields)
   *
   * @param creatorId - Creator ID (for authorization)
   * @param filters - Query filters
   * @param pagination - Pagination parameters
   * @returns Paginated content list with metadata
   */
  async list(
    creatorId: string,
    filters: ContentFilters = {},
    pagination: PaginationParams = {
      page: 1,
      limit: PAGINATION.DEFAULT,
    }
  ): Promise<PaginatedListResponse<ContentWithRelations>> {
    try {
      const { limit, offset } = withPagination(pagination);

      // Build WHERE conditions
      const whereConditions = [scopedNotDeleted(content, creatorId)];

      // Add filters
      if (filters.status) {
        whereConditions.push(eq(content.status, filters.status));
      }
      if (filters.contentType) {
        whereConditions.push(eq(content.contentType, filters.contentType));
      }
      if (filters.visibility) {
        whereConditions.push(eq(content.visibility, filters.visibility));
      }
      if (filters.category) {
        whereConditions.push(eq(content.category, filters.category));
      }
      if (filters.organizationId !== undefined) {
        if (filters.organizationId === null) {
          whereConditions.push(isNull(content.organizationId));
        } else {
          whereConditions.push(
            eq(content.organizationId, filters.organizationId)
          );
        }
      }
      if (filters.search) {
        const searchCondition = or(
          ilike(content.title, `%${filters.search}%`),
          ilike(content.description ?? '', `%${filters.search}%`)
        );
        if (searchCondition) {
          whereConditions.push(searchCondition);
        }
      }

      // Determine sort column and order
      const sortColumn = filters.sortBy || 'createdAt';
      const sortOrder = filters.sortOrder || 'desc';
      const orderByClause =
        sortOrder === 'desc'
          ? desc(content[sortColumn])
          : asc(content[sortColumn]);

      // Get items
      const items = await this.db.query.content.findMany({
        where: and(...whereConditions),
        limit,
        offset,
        orderBy: [orderByClause],
        with: {
          mediaItem: true,
          organization: true,
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
        .from(content)
        .where(and(...whereConditions));

      const totalRecord = countResult[0];
      if (!totalRecord) {
        throw new Error('Failed to get content count');
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
   * Private helper: Validate media item
   *
   * Checks:
   * - Media exists
   * - Media belongs to creator
   * - Media is not deleted
   * - Media status is 'ready' (if requireReady is true)
   * - Media type matches content type
   *
   * @param tx - Database transaction
   * @param mediaItemId - Media item ID
   * @param creatorId - Creator ID
   * @param contentType - Content type
   * @param requireReady - Whether to require media status to be 'ready' (default: true)
   * @throws {MediaNotFoundError} If media doesn't exist or doesn't belong to creator
   * @throws {MediaNotReadyError} If media is not ready (when requireReady is true)
   * @throws {ContentTypeMismatchError} If types don't match
   */
  private async validateMediaItem(
    tx: DatabaseTransaction,
    mediaItemId: string,
    creatorId: string,
    contentType: typeof CONTENT_TYPES.VIDEO | typeof CONTENT_TYPES.AUDIO,
    requireReady: boolean = true
  ): Promise<void> {
    const mediaItem = await tx.query.mediaItems.findFirst({
      where: and(
        eq(mediaItems.id, mediaItemId),
        scopedNotDeleted(mediaItems, creatorId)
      ),
    });

    if (!mediaItem) {
      throw new MediaNotFoundError(mediaItemId);
    }

    // Only check ready status when required (e.g., during publishing)
    if (requireReady && mediaItem.status !== MEDIA_STATUS.READY) {
      throw new MediaNotReadyError(mediaItemId);
    }

    // Validate content type matches media type
    if (
      (contentType === CONTENT_TYPES.VIDEO &&
        mediaItem.mediaType !== MEDIA_TYPES.VIDEO) ||
      (contentType === CONTENT_TYPES.AUDIO &&
        mediaItem.mediaType !== MEDIA_TYPES.AUDIO)
    ) {
      throw new ContentTypeMismatchError(contentType, mediaItem.mediaType);
    }
  }
}
