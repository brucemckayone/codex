/**
 * Admin Content Management Service
 *
 * Provides cross-creator content management for an org's owners and admins,
 * scoped to the organization (NOT creator), and the platform admin's
 * takedown, which is not scoped (a `platform_owner` route).
 *
 * Key Differences from ContentService:
 * - Scoped by organizationId instead of creatorId
 * - Admin can manage ALL content in the org (across all creators)
 * - Soft deletes only (preserves purchase history)
 */

import { CacheType, type VersionedCache } from '@codex/cache';
import { CONTENT_STATUS, PAGINATION } from '@codex/constants';
import {
  assertPublishable,
  type DatabaseTransaction,
  type DeleteContentResult,
  deleteOrLeave,
  goLiveColumns,
  invalidateContentAccess,
  takedownPiece,
} from '@codex/content';
import {
  MEDIA_ITEM_RESPONSE_COLUMNS,
  schema,
  withPagination,
} from '@codex/database';
import { BaseService, NotFoundError } from '@codex/service-errors';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type {
  AdminContentItem,
  AdminContentListOptions,
  PaginatedListResponse,
  TakenDownContent,
} from '../types';

export class AdminContentManagementService extends BaseService {
  private cache?: VersionedCache;

  /**
   * Injected by the service registry, not by a route: see
   * packages/worker-utils/src/procedure/service-registry.ts:1151
   * (`_adminContent.setCache(buildTrackedCache(env.CACHE_KV))`). The receiver
   * there is a module-scope `let` of type `AdminContentManagementService |
   * undefined`, which dead-code detection cannot resolve to this class.
   * ContentService and ConnectAccountService take the same call at :431 and
   * :1014.
   */
  // fallow-ignore-next-line unused-class-member
  setCache(cache: VersionedCache): void {
    this.cache = cache;
  }

  /**
   * List all content in an organization
   *
   * Supports pagination and optional status filtering.
   * Returns content with creator info for admin view.
   */
  async listAllContent(
    organizationId: string,
    options: Partial<AdminContentListOptions> = {}
  ): Promise<PaginatedListResponse<AdminContentItem>> {
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

      // Run items + count queries concurrently (independent queries)
      const [items, countResult] = await Promise.all([
        this.db.query.content.findMany({
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
        }),
        this.db
          .select({ total: count() })
          .from(schema.content)
          .where(and(...whereConditions)),
      ]);

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
      this.handleError(error, 'listAllContent');
    }
  }

  /**
   * Publish content (admin override)
   *
   * Admin can publish any draft content in their organization, under every
   * rule a creator's own publish applies: `assertPublishable` (@codex/content).
   *
   * @throws {NotFoundError} No such draft in the org, or its media item is not
   *   the content creator's (Codex-vmi6m)
   * @throws {BusinessLogicError} (422) A publish rule refused it;
   *   `details.code` names which (see `assertPublishable`)
   * @throws {ForbiddenError} (403, `NOT_ON_ORG_TEAM`) Its creator is no
   *   longer on the org's team
   */
  async publishContent(
    organizationId: string,
    contentId: string
  ): Promise<AdminContentItem> {
    try {
      const result = await this.db.transaction(async (tx) => {
        // The row first, locked FOR NO KEY UPDATE, then its media FOR KEY
        // SHARE below: the order ContentService.publish and update() take
        // them in (no tier lock is taken here), so a PATCH can't swap the
        // media under this publish (Codex-6sbn1). Every read and the write
        // below carry the same org scope.
        const inThisOrg = and(
          eq(schema.content.id, contentId),
          eq(schema.content.organizationId, organizationId),
          isNull(schema.content.deletedAt)
        );
        await tx
          .select({ id: schema.content.id })
          .from(schema.content)
          .where(inThisOrg)
          .for('no key update');
        // Get content with media item
        const existing = await tx.query.content.findFirst({
          where: inThisOrg,
          with: {
            mediaItem: { columns: MEDIA_ITEM_RESPONSE_COLUMNS },
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

        // ContentService.publish's own rules, from the one definition both
        // paths share (Codex-a6ofh.2.1): an admin publish must not route
        // round any of them. It checks the CREATOR, as the content's owner:
        // still on the org's team, media ready, payouts set up.
        await assertPublishable(tx as DatabaseTransaction, existing);

        // Publish content
        await tx
          .update(schema.content)
          // The creator's own go-live columns, from the gate's module, so
          // the two publishes can't drift (Codex-a6ofh.2.7).
          .set(goLiveColumns())
          .where(inThisOrg);

        // Re-fetch with relations for response
        const updated = await tx.query.content.findFirst({
          where: inThisOrg,
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

      // Bump content catalogue version keys (fire-and-forget; invalidate swallows errors)
      void this.cache?.invalidate(CacheType.COLLECTION_CONTENT_PUBLISHED);
      void this.cache?.invalidate(
        CacheType.COLLECTION_ORG_CONTENT(organizationId)
      );

      return result;
    } catch (error) {
      this.handleError(error, 'publishContent');
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

      // Bump content catalogue version keys (fire-and-forget; invalidate swallows errors)
      void this.cache?.invalidate(CacheType.COLLECTION_CONTENT_PUBLISHED);
      void this.cache?.invalidate(
        CacheType.COLLECTION_ORG_CONTENT(organizationId)
      );

      return result;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.handleError(error, 'unpublishContent');
    }
  }

  /**
   * Delete content (an org owner or admin, any creator's piece in the org).
   * The creator's own delete, never a takedown (owner 2026-11-19,
   * Codex-a6ofh.6): a piece nobody holds is deleted at once, and one people
   * hold goes off sale and leaves in 30 days, each holder emailed
   * (`deleteOrLeave`, @codex/content). Scoped to the organization.
   *
   * @returns what the delete did, and the piece's creator (whose folder
   *   holds its cover, cleared by the route once it is deleted)
   */
  async deleteContent(
    organizationId: string,
    contentId: string
  ): Promise<DeleteContentResult & { creatorId: string }> {
    try {
      return await this.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            id: schema.content.id,
            creatorId: schema.content.creatorId,
            status: schema.content.status,
            offSaleAt: schema.content.offSaleAt,
            leavesAt: schema.content.leavesAt,
          })
          .from(schema.content)
          .where(
            and(
              eq(schema.content.id, contentId),
              eq(schema.content.organizationId, organizationId),
              isNull(schema.content.deletedAt)
            )
          )
          .for('no key update');

        if (!existing) {
          throw new NotFoundError('Content not found', {
            contentId,
            organizationId,
          });
        }
        const result = await deleteOrLeave(
          tx as DatabaseTransaction,
          existing,
          this.obs
        );
        return { ...result, creatorId: existing.creatorId };
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.handleError(error, 'deleteContent');
    }
  }

  /**
   * A platform admin's takedown (D4, Codex-a6ofh.6): a legal or policy
   * removal, deleted at once whoever holds it. Each holder is sent the
   * `removed` email instead of a notice, and any notice in flight is
   * cancelled (`takedownPiece`, @codex/content). The `platform_owner`
   * route's alone, so not scoped to an org or a creator.
   *
   * @returns how many held it, and where its cover and caches live
   */
  async takedownContent(contentId: string): Promise<TakenDownContent> {
    try {
      return await this.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            organizationId: schema.content.organizationId,
            creatorId: schema.content.creatorId,
          })
          .from(schema.content)
          .where(
            and(
              eq(schema.content.id, contentId),
              isNull(schema.content.deletedAt)
            )
          )
          .for('no key update');

        if (!existing) {
          throw new NotFoundError('Content not found', { contentId });
        }
        const { holders } = await takedownPiece(
          tx as DatabaseTransaction,
          contentId,
          this.obs
        );
        return { contentId, holders, ...existing };
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.handleError(error, 'takedownContent');
    }
  }

  /**
   * What a delete or a takedown refreshes, run by the route in the
   * background: the platform's and the org's lists, its topics and portal
   * rails, and the library of everyone the piece reached (holders,
   * subscribers, team; `invalidateContentAccess`). The org's slug-keyed
   * stats wait for their TTL, as after an admin publish.
   */
  async refreshAfterDelete(
    piece: { contentId: string; organizationId: string | null },
    reason: 'content_deleted' | 'content_leaving',
    waitUntil: (promise: Promise<unknown>) => void
  ): Promise<void> {
    const { cache } = this;
    if (!cache) return;
    const { contentId, organizationId } = piece;
    const orgKeys = organizationId
      ? [
          CacheType.CATEGORIES(organizationId),
          CacheType.COLLECTION_ORG_JOURNEYS(organizationId),
        ]
      : [];
    await Promise.all([
      ...orgKeys.map((key) => cache.invalidate(key)),
      invalidateContentAccess({
        db: this.db,
        cache,
        waitUntil,
        contentId,
        organizationId,
        reason,
        logger: this.obs,
      }),
    ]).catch((error: unknown) => {
      this.obs.warn('admin content delete: cache refresh failed', {
        contentId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
