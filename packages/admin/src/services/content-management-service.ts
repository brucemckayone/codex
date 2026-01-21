/**
 * Admin Content Management Service
 *
 * Provides cross-creator content management for platform owners.
 * All operations are scoped to organization (NOT creator).
 *
 * Key Differences from ContentService:
 * - Scoped by organizationId instead of creatorId
 * - Admin can manage ALL content in the org (across all creators)
 * - Soft deletes only (preserves purchase history)
 */

import { CONTENT_STATUS, CONTENT_TYPES, PAGINATION } from '@codex/constants';
import { schema, withPagination } from '@codex/database';
import {
  BaseService,
  BusinessLogicError,
  NotFoundError,
  wrapError,
} from '@codex/service-errors';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type {
  AdminContentItem,
  AdminContentListOptions,
  PaginatedResponse,
} from '../types';

export class AdminContentManagementService extends BaseService {
  /**
   * List all content in an organization
   *
   * Supports pagination and optional status filtering.
   * Returns content with creator info for admin view.
   */
  async listAllContent(
    organizationId: string,
    options: Partial<AdminContentListOptions> = {}
  ): Promise<PaginatedResponse<AdminContentItem>> {
    const { page = 1, limit = PAGINATION.DEFAULT, status } = options;

    try {
      // Note: Organization existence is validated by middleware via organizationMemberships FK constraint
      // Build WHERE conditions
      const whereConditions = [
        eq(schema.content.organizationId, organizationId),
        isNull(schema.content.deletedAt),
      ];

      if (status) {
        whereConditions.push(eq(schema.content.status, status));
      }

      // Calculate pagination
      const { limit: safeLimit, offset } = withPagination({ page, limit });

      // Get items with creator info
      const items = await this.db.query.content.findMany({
        where: and(...whereConditions),
        limit: safeLimit,
        offset,
        orderBy: [desc(schema.content.createdAt)],
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
        .from(schema.content)
        .where(and(...whereConditions));

      const total = Number(countResult[0]?.total ?? 0);
      const totalPages = Math.ceil(total / safeLimit);

      return {
        items: items as AdminContentItem[],
        pagination: {
          page,
          limit: safeLimit,
          total,
          totalPages,
        },
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw wrapError(error, { organizationId, options });
    }
  }

  /**
   * Publish content (admin override)
   *
   * Admin can publish any draft content in their organization.
   * Validates media is ready for video/audio content.
   */
  async publishContent(
    organizationId: string,
    contentId: string
  ): Promise<AdminContentItem> {
    try {
      const result = await this.db.transaction(async (tx) => {
        // Get content with media item
        const existing = await tx.query.content.findFirst({
          where: and(
            eq(schema.content.id, contentId),
            eq(schema.content.organizationId, organizationId),
            isNull(schema.content.deletedAt)
          ),
          with: {
            mediaItem: true,
            creator: {
              columns: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        });

        if (!existing) {
          throw new NotFoundError('Content not found', {
            contentId,
            organizationId,
          });
        }

        // Already published - idempotent
        if (existing.status === CONTENT_STATUS.PUBLISHED) {
          return existing as AdminContentItem;
        }

        // Validate content is ready to publish (video/audio need ready media)
        if (
          [CONTENT_TYPES.VIDEO, CONTENT_TYPES.AUDIO].includes(
            existing.contentType as (typeof CONTENT_TYPES)[keyof typeof CONTENT_TYPES]
          )
        ) {
          if (!existing.mediaItem) {
            throw new BusinessLogicError(
              'Cannot publish content without media',
              {
                contentId,
                contentType: existing.contentType,
              }
            );
          }
          if (existing.mediaItem.status !== 'ready') {
            throw new BusinessLogicError('Media is not ready for publishing', {
              contentId,
              mediaItemId: existing.mediaItem.id,
              mediaStatus: existing.mediaItem.status,
            });
          }
        }

        // Publish content
        await tx
          .update(schema.content)
          .set({
            status: CONTENT_STATUS.PUBLISHED,
            publishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.content.id, contentId));

        // Re-fetch with relations for response
        const updated = await tx.query.content.findFirst({
          where: eq(schema.content.id, contentId),
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

        return updated as AdminContentItem;
      });

      return result;
    } catch (error) {
      if (
        error instanceof NotFoundError ||
        error instanceof BusinessLogicError
      ) {
        throw error;
      }
      throw wrapError(error, { organizationId, contentId });
    }
  }

  /**
   * Unpublish content (admin override)
   *
   * Admin can unpublish any published content in their organization.
   * Sets status back to 'draft'.
   */
  async unpublishContent(
    organizationId: string,
    contentId: string
  ): Promise<AdminContentItem> {
    try {
      const result = await this.db.transaction(async (tx) => {
        // Verify content exists and belongs to organization
        const existing = await tx.query.content.findFirst({
          where: and(
            eq(schema.content.id, contentId),
            eq(schema.content.organizationId, organizationId),
            isNull(schema.content.deletedAt)
          ),
        });

        if (!existing) {
          throw new NotFoundError('Content not found', {
            contentId,
            organizationId,
          });
        }

        // Already draft - idempotent
        if (existing.status === CONTENT_STATUS.DRAFT) {
          const contentWithCreator = await tx.query.content.findFirst({
            where: eq(schema.content.id, contentId),
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
          return contentWithCreator as AdminContentItem;
        }

        // Unpublish content
        await tx
          .update(schema.content)
          .set({
            status: CONTENT_STATUS.DRAFT,
            updatedAt: new Date(),
          })
          .where(eq(schema.content.id, contentId));

        // Re-fetch with relations
        const updated = await tx.query.content.findFirst({
          where: eq(schema.content.id, contentId),
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

        return updated as AdminContentItem;
      });

      return result;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw wrapError(error, { organizationId, contentId });
    }
  }

  /**
   * Soft delete content (admin override)
   *
   * Admin can delete any content in their organization.
   * Uses soft delete (sets deletedAt) to preserve purchase history.
   */
  async deleteContent(
    organizationId: string,
    contentId: string
  ): Promise<boolean> {
    try {
      await this.db.transaction(async (tx) => {
        // Verify content exists and belongs to organization
        const existing = await tx.query.content.findFirst({
          where: and(
            eq(schema.content.id, contentId),
            eq(schema.content.organizationId, organizationId),
            isNull(schema.content.deletedAt)
          ),
        });

        if (!existing) {
          throw new NotFoundError('Content not found', {
            contentId,
            organizationId,
          });
        }

        // Soft delete
        await tx
          .update(schema.content)
          .set({
            deletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.content.id, contentId));
      });

      return true;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw wrapError(error, { organizationId, contentId });
    }
  }
}
