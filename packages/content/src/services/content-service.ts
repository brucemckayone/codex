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

import { and, eq, isNull, desc, asc, count, or, ilike } from 'drizzle-orm';
import type { CreateContentInput, UpdateContentInput } from '@codex/validation';
import { createContentSchema, updateContentSchema } from '@codex/validation';
import { content, mediaItems } from '@codex/database/schema';
import { isUniqueViolation } from '@codex/database';
import type {
  Database,
  DatabaseTransaction,
  ServiceConfig,
  PaginationParams,
  PaginatedResponse,
  ContentFilters,
  Content,
  ContentWithRelations,
} from '../types';
import {
  ContentNotFoundError,
  MediaNotFoundError,
  MediaNotReadyError,
  ContentTypeMismatchError,
  BusinessLogicError,
  wrapError,
  SlugConflictError,
} from '../errors';

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
export class ContentService {
  private db: Database;
  private environment: string;

  constructor(config: ServiceConfig) {
    this.db = config.db;
    this.environment = config.environment;
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
      return await this.db.transaction(async (tx) => {
        // Step 3: Validate media item (if provided)
        // Note: For draft creation, we don't require media to be ready
        // The ready check happens during publishing
        if (validated.mediaItemId) {
          await this.validateMediaItem(
            tx,
            validated.mediaItemId,
            creatorId,
            validated.contentType,
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
            visibility: validated.visibility || 'purchased_only',
            priceCents: validated.priceCents ?? null,
            status: 'draft', // Always start as draft
            viewCount: 0,
            purchaseCount: 0,
          })
          .returning();

        return newContent;
      });
    } catch (error) {
      // Handle unique constraint violations (slug conflicts)
      if (isUniqueViolation(error)) {
        throw new SlugConflictError(
          validated.slug,
          validated.organizationId || null
        );
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
        where: and(
          eq(content.id, id),
          eq(content.creatorId, creatorId),
          isNull(content.deletedAt)
        ),
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
      return await this.db.transaction(async (tx) => {
        // Verify content exists and belongs to creator
        const existing = await tx.query.content.findFirst({
          where: and(
            eq(content.id, id),
            eq(content.creatorId, creatorId),
            isNull(content.deletedAt)
          ),
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
          .where(and(eq(content.id, id), eq(content.creatorId, creatorId)))
          .returning();

        return updated;
      });
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw error;
      }
      throw wrapError(error, { contentId: id, creatorId, input: validated });
    }
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
      return await this.db.transaction(async (tx) => {
        // Get content with media item
        const existing = await tx.query.content.findFirst({
          where: and(
            eq(content.id, id),
            eq(content.creatorId, creatorId),
            isNull(content.deletedAt)
          ),
          with: {
            mediaItem: true,
          },
        });

        if (!existing) {
          throw new ContentNotFoundError(id);
        }

        // Already published - idempotent
        if (existing.status === 'published') {
          return existing;
        }

        // Validate content is ready to publish
        if (['video', 'audio'].includes(existing.contentType)) {
          if (!existing.mediaItem) {
            throw new BusinessLogicError(
              'Cannot publish content without media',
              {
                contentId: id,
                contentType: existing.contentType,
              }
            );
          }
          if (existing.mediaItem.status !== 'ready') {
            throw new MediaNotReadyError(
              existing.mediaItem.id,
              existing.mediaItem.status
            );
          }
        }

        // Publish content
        const [published] = await tx
          .update(content)
          .set({
            status: 'published',
            publishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(content.id, id), eq(content.creatorId, creatorId)))
          .returning();

        return published;
      });
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
      const existing = await this.db.query.content.findFirst({
        where: and(
          eq(content.id, id),
          eq(content.creatorId, creatorId),
          isNull(content.deletedAt)
        ),
      });

      if (!existing) {
        throw new ContentNotFoundError(id);
      }

      const [unpublished] = await this.db
        .update(content)
        .set({
          status: 'draft',
          updatedAt: new Date(),
        })
        .where(and(eq(content.id, id), eq(content.creatorId, creatorId)))
        .returning();

      return unpublished;
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
      const existing = await this.db.query.content.findFirst({
        where: and(
          eq(content.id, id),
          eq(content.creatorId, creatorId),
          isNull(content.deletedAt)
        ),
      });

      if (!existing) {
        throw new ContentNotFoundError(id);
      }

      await this.db
        .update(content)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(content.id, id), eq(content.creatorId, creatorId)));
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
    pagination: PaginationParams = { page: 1, limit: 20 }
  ): Promise<PaginatedResponse<ContentWithRelations>> {
    try {
      const { page, limit } = pagination;
      const offset = (page - 1) * limit;

      // Build WHERE conditions
      const whereConditions = [
        eq(content.creatorId, creatorId),
        isNull(content.deletedAt),
      ];

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
        whereConditions.push(
          or(
            ilike(content.title, `%${filters.search}%`),
            ilike(content.description ?? '', `%${filters.search}%`)
          )!
        );
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
      const [{ total }] = await this.db
        .select({ total: count() })
        .from(content)
        .where(and(...whereConditions));

      const totalCount = Number(total);
      const totalPages = Math.ceil(totalCount / limit);

      return {
        items,
        pagination: {
          page,
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
    contentType: 'video' | 'audio' | 'written',
    requireReady: boolean = true
  ): Promise<void> {
    const mediaItem = await tx.query.mediaItems.findFirst({
      where: and(
        eq(mediaItems.id, mediaItemId),
        eq(mediaItems.creatorId, creatorId),
        isNull(mediaItems.deletedAt)
      ),
    });

    if (!mediaItem) {
      throw new MediaNotFoundError(mediaItemId);
    }

    // Only check ready status when required (e.g., during publishing)
    if (requireReady && mediaItem.status !== 'ready') {
      throw new MediaNotReadyError(mediaItemId, mediaItem.status);
    }

    // Validate content type matches media type
    if (
      (contentType === 'video' && mediaItem.mediaType !== 'video') ||
      (contentType === 'audio' && mediaItem.mediaType !== 'audio')
    ) {
      throw new ContentTypeMismatchError(contentType, mediaItem.mediaType);
    }
  }
}

/**
 * Factory function to create ContentService instance
 *
 * Usage:
 * ```typescript
 * const service = createContentService({ db, environment: 'production' });
 * const content = await service.create(input, creatorId);
 * ```
 */
export function createContentService(config: ServiceConfig): ContentService {
  return new ContentService(config);
}
