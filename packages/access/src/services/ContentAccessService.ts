import type { R2Bucket } from '@cloudflare/workers-types';
import { R2Service, type R2SigningConfig } from '@codex/cloudflare-clients';
import {
  CONTENT_STATUS,
  ENV_NAMES,
  MEDIA_STATUS,
  MEDIA_TYPES,
  PURCHASE_STATUS,
  VIDEO_PROGRESS,
} from '@codex/constants';
import type { DatabaseWs } from '@codex/database';
import { createPerRequestDbClient } from '@codex/database';
import {
  content,
  mediaItems,
  organizationMemberships,
  organizations,
  purchases,
  subscriptions,
  subscriptionTiers,
  videoPlayback,
} from '@codex/database/schema';
import { ObservabilityClient } from '@codex/observability';
import { createStripeClient, PurchaseService } from '@codex/purchase';
import { wrapError } from '@codex/service-errors';
import type {
  GetPlaybackProgressInput,
  GetStreamingUrlInput,
  ListUserLibraryInput,
  SavePlaybackProgressInput,
} from '@codex/validation';
import {
  and,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { LOG_EVENTS, LOG_SEVERITY, SERVICE_NAME } from '../constants';
import {
  AccessDeniedError,
  ContentNotFoundError,
  InvalidContentTypeError,
  MediaNotReadyForStreamingError,
  R2SigningError,
} from '../errors';

/**
 * Interface for R2 signing functionality.
 * Can be implemented by R2Service (workers) or R2SigningClient (tests/scripts).
 */
interface R2Signer {
  generateSignedUrl(r2Key: string, expirySeconds: number): Promise<string>;
}

/**
 * Development-only R2Signer that returns unsigned dev-cdn URLs.
 * Miniflare R2 serves objects by key without signature verification.
 */
class DevR2Signer implements R2Signer {
  constructor(private baseUrl: string) {}

  async generateSignedUrl(
    r2Key: string,
    _expirySeconds: number
  ): Promise<string> {
    return `${this.baseUrl}/${r2Key}`;
  }
}

/**
 * User library item with content, access type, purchase, and progress information
 */
interface UserLibraryItem {
  content: {
    id: string;
    slug: string;
    title: string;
    description: string;
    thumbnailUrl: string | null;
    contentType: string;
    durationSeconds: number;
    organizationSlug: string | null;
  };
  /** How the user has access: 'purchased' or 'membership' */
  accessType: 'purchased' | 'membership';
  purchase: {
    purchasedAt: string;
    priceCents: number;
  } | null;
  progress: {
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
    percentComplete: number;
    updatedAt: string;
  } | null;
}

/**
 * User library response with pagination
 */
interface UserLibraryResponse {
  items: UserLibraryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ContentAccessServiceConfig {
  db: DatabaseWs; // WebSocket client for transaction support
  r2: R2Signer;
  obs: ObservabilityClient;
  purchaseService: PurchaseService;
}

/**
 * Content Access Service
 *
 * Responsibilities:
 * 1. Verify user has access to content (purchase or free)
 * 2. Generate time-limited signed R2 URLs for streaming
 * 3. Track video playback progress for resume functionality
 * 4. List user's content library with progress
 *
 * Security:
 * - All methods require authenticated userId
 * - Purchase verification before generating signed URLs
 * - Only published, non-deleted content is accessible
 * - Row-level security enforced via user_id filters
 *
 * Integration points:
 * - P1-CONTENT-001: Queries content and media_items tables
 * - P1-ECOM-001: Verifies purchases table for access
 * - R2 Service: Generates presigned URLs via AWS SDK
 */
export class ContentAccessService {
  constructor(private config: ContentAccessServiceConfig) {}

  /**
   * Generate signed streaming URL for content
   *
   * Access control flow:
   * 1. Verify content exists and is published (any organization)
   * 2. Check if content is free (price_cents = 0) → grant access
   * 3. If paid, check if user has purchased this content → grant access
   * 4. If no purchase, check if user is member of content's organization → grant access
   * 5. Otherwise → ACCESS_DENIED
   * 6. Generate time-limited signed R2 URL
   *
   * Transaction safety:
   * - All queries wrapped in transaction for consistent snapshot
   * - Read committed isolation level for access verification
   *
   * @param userId - Authenticated user ID
   * @param input - Content ID and optional expiry
   * @returns Streaming URL and expiration timestamp
   * @throws {ContentNotFoundError} Content doesn't exist, is draft, or is deleted
   * @throws {AccessDeniedError} User hasn't purchased content and isn't org member
   * @throws {R2SigningError} Failed to generate signed URL
   */
  async getStreamingUrl(
    userId: string,
    input: GetStreamingUrlInput
  ): Promise<{
    streamingUrl: string;
    expiresAt: Date;
    contentType: 'video' | 'audio';
  }> {
    const { db, r2, obs } = this.config;

    obs.info('Getting streaming URL', {
      userId,
      contentId: input.contentId,
      expirySeconds: input.expirySeconds,
    });

    try {
      // Step 1 & 2: Verify access and fetch content/media data within transaction
      // Transaction ensures consistent snapshot for access verification
      const { r2Key, mediaType } = await db.transaction(
        async (tx) => {
          // Get content with media details (any organization)
          const contentRecord = await tx.query.content.findFirst({
            where: and(
              eq(content.id, input.contentId),
              eq(content.status, CONTENT_STATUS.PUBLISHED),
              isNull(content.deletedAt)
            ),
            with: {
              mediaItem: true, // Includes r2_key, content_type, duration
            },
          });

          if (!contentRecord) {
            obs.warn('Content not found or not accessible', {
              contentId: input.contentId,
              userId,
            });

            throw new ContentNotFoundError(input.contentId);
          }

          if (!contentRecord.mediaItem) {
            obs.warn('Content has no associated media item', {
              contentId: input.contentId,
              userId,
            });
            throw new ContentNotFoundError(input.contentId, {
              reason: 'no_media_item',
            });
          }

          // Check access - free content, purchase, or org membership
          if (contentRecord.priceCents && contentRecord.priceCents > 0) {
            // Paid content - check purchase via PurchaseService
            const hasPurchased =
              await this.config.purchaseService.verifyPurchase(
                input.contentId,
                userId
              );

            if (hasPurchased) {
              obs.info('Access granted via purchase', {
                userId,
                contentId: input.contentId,
              });
            } else {
              // No purchase — check subscription tier access
              let hasSubscriptionAccess = false;

              if (contentRecord.minimumTierId && contentRecord.organizationId) {
                const userSub = await tx.query.subscriptions.findFirst({
                  where: and(
                    eq(subscriptions.userId, userId),
                    eq(
                      subscriptions.organizationId,
                      contentRecord.organizationId
                    ),
                    inArray(subscriptions.status, ['active', 'cancelling']),
                    gt(subscriptions.currentPeriodEnd, new Date())
                  ),
                  with: { tier: true },
                });

                if (userSub) {
                  // Get the content's minimum tier for sort order comparison
                  const contentTier =
                    await tx.query.subscriptionTiers.findFirst({
                      where: eq(
                        subscriptionTiers.id,
                        contentRecord.minimumTierId
                      ),
                    });

                  if (
                    contentTier &&
                    userSub.tier.sortOrder >= contentTier.sortOrder
                  ) {
                    hasSubscriptionAccess = true;
                    obs.info('Access granted via subscription', {
                      userId,
                      contentId: input.contentId,
                      subscriptionTier: userSub.tier.name,
                      contentMinTier: contentTier.name,
                    });
                  }
                }
              }

              if (!hasSubscriptionAccess) {
                // No subscription access — fall back to org membership check
                const contentOrgId = contentRecord.organizationId;

                if (!contentOrgId) {
                  // Personal content with no org - requires purchase
                  obs.warn(
                    'Access denied - paid personal content requires purchase',
                    {
                      userId,
                      contentId: input.contentId,
                      priceCents: contentRecord.priceCents,
                      securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
                      severity: LOG_SEVERITY.MEDIUM,
                      eventType: LOG_EVENTS.ACCESS_CONTROL,
                    }
                  );
                  throw new AccessDeniedError(userId, input.contentId, {
                    priceCents: contentRecord.priceCents,
                  });
                }

                // Check if user is active member of content's organization
                const membership =
                  await tx.query.organizationMemberships.findFirst({
                    where: and(
                      eq(organizationMemberships.organizationId, contentOrgId),
                      eq(organizationMemberships.userId, userId),
                      eq(organizationMemberships.status, 'active')
                    ),
                  });

                if (!membership) {
                  obs.warn('Access denied - no purchase and not org member', {
                    userId,
                    contentId: input.contentId,
                    organizationId: contentOrgId,
                    priceCents: contentRecord.priceCents,
                    securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
                    severity: LOG_SEVERITY.MEDIUM,
                    eventType: LOG_EVENTS.ACCESS_CONTROL,
                  });
                  throw new AccessDeniedError(userId, input.contentId, {
                    priceCents: contentRecord.priceCents,
                    organizationId: contentOrgId,
                  });
                }

                obs.info('Access granted via organization membership', {
                  userId,
                  contentId: input.contentId,
                  organizationId: contentOrgId,
                  membershipRole: membership.role,
                });
              } // end if (!hasSubscriptionAccess)
            }
          } else {
            obs.info('Free content - access granted', {
              contentId: input.contentId,
            });
          }

          // Verify media is ready for streaming (status='ready' with transcoding outputs)
          const mediaStatus = contentRecord.mediaItem.status;
          if (mediaStatus !== MEDIA_STATUS.READY) {
            obs.warn('Media not ready for streaming', {
              contentId: input.contentId,
              mediaItemId: contentRecord.mediaItem.id,
              status: mediaStatus,
            });
            throw new MediaNotReadyForStreamingError(
              contentRecord.mediaItem.id,
              mediaStatus
            );
          }

          // Extract HLS master playlist key for streaming
          // Database constraint ensures this exists when status='ready'
          const r2Key = contentRecord.mediaItem.hlsMasterPlaylistKey;

          if (!r2Key) {
            // This should never happen due to database constraint, but defensive check
            obs.error('Media marked ready but missing HLS key', {
              contentId: input.contentId,
              mediaItemId: contentRecord.mediaItem.id,
            });
            throw new R2SigningError(
              'missing_hls_key',
              new Error(
                'Media marked as ready but HLS master playlist key is missing'
              )
            );
          }

          // Validate media type (defense-in-depth)
          const mediaType = contentRecord.mediaItem.mediaType;

          if (
            !([MEDIA_TYPES.VIDEO, MEDIA_TYPES.AUDIO] as string[]).includes(
              mediaType
            )
          ) {
            obs.error('Invalid media type', {
              mediaType,
              contentId: input.contentId,
              mediaItemId: contentRecord.mediaItem.id,
            });
            throw new InvalidContentTypeError(input.contentId, mediaType);
          }

          // Return data for R2 signing (outside transaction)
          return {
            r2Key,
            mediaType: mediaType as 'video' | 'audio',
          };
        },
        {
          isolationLevel: 'read committed', // Consistent snapshot for access verification
          accessMode: 'read only', // All operations are reads
        }
      );

      // Step 3: Generate signed R2 URL (OUTSIDE transaction - external API call)
      try {
        const streamingUrl = await r2.generateSignedUrl(
          r2Key,
          input.expirySeconds
        );
        const expiresAt = new Date(Date.now() + input.expirySeconds * 1000);

        obs.info('Streaming URL generated successfully', {
          userId,
          contentId: input.contentId,
          contentType: mediaType,
          expiresAt: expiresAt.toISOString(),
        });

        return {
          streamingUrl,
          expiresAt,
          contentType: mediaType,
        };
      } catch (err) {
        obs.error('Failed to generate signed R2 URL', {
          errorMessage: err instanceof Error ? err.message : String(err),
          errorStack: err instanceof Error ? err.stack : undefined,
          errorName: err instanceof Error ? err.name : undefined,
          userId,
          contentId: input.contentId,
          r2Key,
        });
        throw new R2SigningError(r2Key, err);
      }
    } catch (error) {
      // Re-throw domain errors as-is, wrap unexpected errors
      if (
        error instanceof ContentNotFoundError ||
        error instanceof AccessDeniedError ||
        error instanceof InvalidContentTypeError ||
        error instanceof MediaNotReadyForStreamingError ||
        error instanceof R2SigningError
      ) {
        throw error;
      }
      obs.error('Unexpected error in getStreamingUrl', {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
        userId,
        contentId: input.contentId,
      });
      throw wrapError(error, { userId, contentId: input.contentId });
    }
  }

  /**
   * Save playback progress (upsert pattern)
   *
   * @param userId - Authenticated user ID
   * @param input - Content ID, position, duration, completed flag
   */
  async savePlaybackProgress(
    userId: string,
    input: SavePlaybackProgressInput
  ): Promise<void> {
    const { db, obs } = this.config;

    // Auto-complete if watched >= completion threshold
    const completionThreshold =
      input.durationSeconds * VIDEO_PROGRESS.COMPLETION_THRESHOLD;
    const isCompleted = input.positionSeconds >= completionThreshold;

    obs.info('Saving playback progress', {
      userId,
      contentId: input.contentId,
      positionSeconds: input.positionSeconds,
      durationSeconds: input.durationSeconds,
      completed: isCompleted,
    });

    // Upsert using unique constraint with optimistic concurrency control
    // Only update if new position is greater (prevents backwards seeking overwrites)
    await db
      .insert(videoPlayback)
      .values({
        userId,
        contentId: input.contentId,
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
        completed: isCompleted || input.completed,
      })
      .onConflictDoUpdate({
        target: [videoPlayback.userId, videoPlayback.contentId],
        set: {
          positionSeconds: sql`GREATEST(${videoPlayback.positionSeconds}, ${input.positionSeconds})`,
          durationSeconds: input.durationSeconds,
          completed: sql`${videoPlayback.completed} OR ${isCompleted || input.completed}`,
          updatedAt: new Date(),
        },
      });

    obs.info('Playback progress saved', {
      userId,
      contentId: input.contentId,
      completed: isCompleted,
    });
  }

  /**
   * Get playback progress for specific content
   *
   * @param userId - Authenticated user ID
   * @param input - Content ID
   * @returns Progress object or null
   */
  async getPlaybackProgress(
    userId: string,
    input: GetPlaybackProgressInput
  ): Promise<{
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
    updatedAt: Date;
  } | null> {
    const { db } = this.config;

    const progress = await db.query.videoPlayback.findFirst({
      where: and(
        eq(videoPlayback.userId, userId),
        eq(videoPlayback.contentId, input.contentId)
      ),
    });

    if (!progress) {
      return null;
    }

    return {
      positionSeconds: progress.positionSeconds,
      durationSeconds: progress.durationSeconds,
      completed: progress.completed,
      updatedAt: progress.updatedAt,
    };
  }

  /**
   * List user's purchased content library with playback progress
   *
   * @param userId - Authenticated user ID
   * @param input - Pagination, filter, sort options
   * @returns Paginated list of content with progress
   */
  async listUserLibrary(
    userId: string,
    input: ListUserLibraryInput
  ): Promise<UserLibraryResponse> {
    const { db, obs } = this.config;

    obs.info('Listing user library', {
      userId,
      page: input.page,
      filter: input.filter,
      sortBy: input.sortBy,
      contentType: input.contentType,
      accessType: input.accessType,
      search: input.search,
    });

    const offset = (input.page - 1) * input.limit;

    // ── Step 1: Resolve active membership org IDs ─────────────────────
    const membershipConditions = [
      eq(organizationMemberships.userId, userId),
      eq(organizationMemberships.status, 'active'),
    ];
    if (input.organizationId) {
      membershipConditions.push(
        eq(organizationMemberships.organizationId, input.organizationId)
      );
    }

    const activeMemberships =
      input.accessType === 'purchased'
        ? []
        : await db.query.organizationMemberships.findMany({
            where: and(...membershipConditions),
            columns: { organizationId: true },
          });
    const memberOrgIds = activeMemberships.map((m) => m.organizationId);

    // ── Step 2: Build shared filter conditions ────────────────────────
    const buildContentFilters = () => {
      const conditions: ReturnType<typeof eq>[] = [];
      if (input.contentType && input.contentType !== 'all') {
        conditions.push(eq(content.contentType, input.contentType));
      }
      if (input.search) {
        const pattern = `%${input.search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
        const searchCondition = or(
          ilike(content.title, pattern),
          ilike(content.description ?? '', pattern)
        );
        if (searchCondition) conditions.push(searchCondition);
      }
      return conditions;
    };

    const buildProgressFilters = () => {
      const conditions: ReturnType<typeof eq>[] = [];
      if (input.filter === 'completed') {
        conditions.push(eq(videoPlayback.completed, true));
      } else if (input.filter === 'in_progress') {
        conditions.push(gt(videoPlayback.positionSeconds, 0));
        const notCompleted = or(
          isNull(videoPlayback.completed),
          eq(videoPlayback.completed, false)
        );
        if (notCompleted) conditions.push(notCompleted);
      } else if (input.filter === 'not_started') {
        const noProgress = or(
          isNull(videoPlayback.positionSeconds),
          eq(videoPlayback.positionSeconds, 0)
        );
        if (noProgress) conditions.push(noProgress);
        const notCompleted = or(
          isNull(videoPlayback.completed),
          eq(videoPlayback.completed, false)
        );
        if (notCompleted) conditions.push(notCompleted);
      }
      return conditions;
    };

    const contentFilters = buildContentFilters();
    const progressFilters = buildProgressFilters();

    // ── Helper: map a row to UserLibraryItem ──────────────────────────
    const mapProgress = (row: {
      progressPositionSeconds: number | null;
      progressDurationSeconds: number | null;
      progressCompleted: boolean | null;
      progressUpdatedAt: Date | null;
    }): UserLibraryItem['progress'] => {
      if (!row.progressUpdatedAt) return null;
      const pos = row.progressPositionSeconds ?? 0;
      const dur = row.progressDurationSeconds ?? 0;
      return {
        positionSeconds: pos,
        durationSeconds: dur,
        completed: row.progressCompleted ?? false,
        percentComplete: dur > 0 ? Math.round((pos / dur) * 100) : 0,
        updatedAt: row.progressUpdatedAt.toISOString(),
      };
    };

    // ── Step 3: Query purchased items ─────────────────────────────────
    const queryPurchased = async () => {
      if (input.accessType === 'membership') {
        return { items: [] as UserLibraryItem[], count: 0 };
      }

      const conditions = [
        eq(purchases.customerId, userId),
        eq(purchases.status, PURCHASE_STATUS.COMPLETED),
        ...contentFilters,
        ...progressFilters,
      ];
      if (input.organizationId) {
        conditions.push(eq(purchases.organizationId, input.organizationId));
      }

      const sortClause =
        input.sortBy === 'title'
          ? content.title
          : input.sortBy === 'duration'
            ? sql`COALESCE(${mediaItems.durationSeconds}, 0)`
            : purchases.createdAt;

      const baseFrom = db
        .select({
          contentId: content.id,
          contentSlug: content.slug,
          contentTitle: content.title,
          contentDescription: content.description,
          contentThumbnailUrl: content.thumbnailUrl,
          contentType: content.contentType,
          mediaThumbnailKey: mediaItems.thumbnailKey,
          mediaDurationSeconds: mediaItems.durationSeconds,
          orgSlug: organizations.slug,
          purchasedAt: purchases.createdAt,
          amountPaidCents: purchases.amountPaidCents,
          progressPositionSeconds: videoPlayback.positionSeconds,
          progressDurationSeconds: videoPlayback.durationSeconds,
          progressCompleted: videoPlayback.completed,
          progressUpdatedAt: videoPlayback.updatedAt,
        })
        .from(purchases)
        .innerJoin(content, eq(content.id, purchases.contentId))
        .leftJoin(mediaItems, eq(mediaItems.id, content.mediaItemId))
        .leftJoin(organizations, eq(organizations.id, content.organizationId))
        .leftJoin(
          videoPlayback,
          and(
            eq(videoPlayback.contentId, content.id),
            eq(videoPlayback.userId, userId)
          )
        );

      const countQuery = db
        .select({ count: sql<number>`count(*)::int` })
        .from(purchases)
        .innerJoin(content, eq(content.id, purchases.contentId))
        .leftJoin(mediaItems, eq(mediaItems.id, content.mediaItemId))
        .leftJoin(
          videoPlayback,
          and(
            eq(videoPlayback.contentId, content.id),
            eq(videoPlayback.userId, userId)
          )
        )
        .where(and(...conditions));

      const dataQuery = baseFrom
        .where(and(...conditions))
        .orderBy(input.sortBy === 'title' ? sortClause : desc(sortClause))
        .limit(input.limit)
        .offset(offset);

      const [countResult, rows] = await Promise.all([countQuery, dataQuery]);

      const items: UserLibraryItem[] = rows.map((row) => ({
        content: {
          id: row.contentId,
          slug: row.contentSlug,
          title: row.contentTitle,
          description: row.contentDescription || '',
          thumbnailUrl:
            row.contentThumbnailUrl ?? row.mediaThumbnailKey ?? null,
          contentType: row.contentType ?? 'video',
          durationSeconds: row.mediaDurationSeconds ?? 0,
          organizationSlug: row.orgSlug ?? null,
        },
        accessType: 'purchased' as const,
        purchase: {
          purchasedAt: row.purchasedAt.toISOString(),
          priceCents: row.amountPaidCents,
        },
        progress: mapProgress(row),
      }));

      return { items, count: countResult[0]?.count ?? 0 };
    };

    // ── Step 4: Query membership items ────────────────────────────────
    const queryMembership = async () => {
      if (input.accessType === 'purchased' || memberOrgIds.length === 0) {
        return { items: [] as UserLibraryItem[], count: 0 };
      }

      const conditions = [
        inArray(content.organizationId, memberOrgIds),
        eq(content.status, CONTENT_STATUS.PUBLISHED),
        isNull(content.deletedAt),
        // Exclude content the user already purchased
        sql`${content.id} NOT IN (SELECT ${purchases.contentId} FROM ${purchases} WHERE ${purchases.customerId} = ${userId} AND ${purchases.status} = ${PURCHASE_STATUS.COMPLETED})`,
        ...contentFilters,
        ...progressFilters,
      ];

      const sortClause =
        input.sortBy === 'title'
          ? content.title
          : input.sortBy === 'duration'
            ? sql`COALESCE(${mediaItems.durationSeconds}, 0)`
            : content.createdAt;

      const baseFrom = db
        .select({
          contentId: content.id,
          contentSlug: content.slug,
          contentTitle: content.title,
          contentDescription: content.description,
          contentThumbnailUrl: content.thumbnailUrl,
          contentType: content.contentType,
          mediaThumbnailKey: mediaItems.thumbnailKey,
          mediaDurationSeconds: mediaItems.durationSeconds,
          orgSlug: organizations.slug,
          contentCreatedAt: content.createdAt,
          progressPositionSeconds: videoPlayback.positionSeconds,
          progressDurationSeconds: videoPlayback.durationSeconds,
          progressCompleted: videoPlayback.completed,
          progressUpdatedAt: videoPlayback.updatedAt,
        })
        .from(content)
        .leftJoin(mediaItems, eq(mediaItems.id, content.mediaItemId))
        .leftJoin(organizations, eq(organizations.id, content.organizationId))
        .leftJoin(
          videoPlayback,
          and(
            eq(videoPlayback.contentId, content.id),
            eq(videoPlayback.userId, userId)
          )
        );

      const countQuery = db
        .select({ count: sql<number>`count(*)::int` })
        .from(content)
        .leftJoin(mediaItems, eq(mediaItems.id, content.mediaItemId))
        .leftJoin(
          videoPlayback,
          and(
            eq(videoPlayback.contentId, content.id),
            eq(videoPlayback.userId, userId)
          )
        )
        .where(and(...conditions));

      const dataQuery = baseFrom
        .where(and(...conditions))
        .orderBy(input.sortBy === 'title' ? sortClause : desc(sortClause))
        .limit(input.limit)
        .offset(offset);

      const [countResult, rows] = await Promise.all([countQuery, dataQuery]);

      const items: UserLibraryItem[] = rows.map((row) => ({
        content: {
          id: row.contentId,
          slug: row.contentSlug,
          title: row.contentTitle,
          description: row.contentDescription || '',
          thumbnailUrl:
            row.contentThumbnailUrl ?? row.mediaThumbnailKey ?? null,
          contentType: row.contentType ?? 'video',
          durationSeconds: row.mediaDurationSeconds ?? 0,
          organizationSlug: row.orgSlug ?? null,
        },
        accessType: 'membership' as const,
        purchase: null,
        progress: mapProgress(row),
      }));

      return { items, count: countResult[0]?.count ?? 0 };
    };

    // ── Step 5: Execute both queries in parallel ──────────────────────
    const [purchaseResult, membershipResult] = await Promise.all([
      queryPurchased(),
      queryMembership(),
    ]);

    // ── Step 6: Merge, sort, and paginate ─────────────────────────────
    // When both sources contribute items, we need to merge-sort them.
    // When only one source is active (accessType filter or no memberships),
    // the DB already handled pagination — return directly.
    const singleSource =
      input.accessType === 'purchased' ||
      input.accessType === 'membership' ||
      memberOrgIds.length === 0 ||
      purchaseResult.count === 0 ||
      membershipResult.count === 0;

    if (singleSource) {
      const result =
        purchaseResult.count > 0 || input.accessType === 'purchased'
          ? purchaseResult
          : membershipResult;
      return {
        items: result.items,
        pagination: {
          page: input.page,
          limit: input.limit,
          total: result.count,
          totalPages: Math.max(1, Math.ceil(result.count / input.limit)),
        },
      };
    }

    // Both sources have items — merge sort (both fetched with LIMIT/OFFSET
    // from their own source, so we re-fetch without offset for merge)
    const totalCount = purchaseResult.count + membershipResult.count;
    const allItems = [...purchaseResult.items, ...membershipResult.items];

    if (input.sortBy === 'title') {
      allItems.sort((a, b) => a.content.title.localeCompare(b.content.title));
    } else if (input.sortBy === 'duration') {
      allItems.sort(
        (a, b) =>
          (b.content.durationSeconds ?? 0) - (a.content.durationSeconds ?? 0)
      );
    } else {
      allItems.sort((a, b) => {
        const dateA = a.purchase?.purchasedAt ?? '';
        const dateB = b.purchase?.purchasedAt ?? '';
        return dateB.localeCompare(dateA);
      });
    }

    // Trim to page size (each source may have returned up to limit items)
    const items = allItems.slice(0, input.limit);

    return {
      items,
      pagination: {
        page: input.page,
        limit: input.limit,
        total: totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / input.limit)),
      },
    };
  }
}

/**
 * Environment configuration for ContentAccessService
 *
 * This type uses Partial to align with the shared Bindings type,
 * but the factory function validates all required fields are present.
 */
export interface ContentAccessEnv {
  /** R2 bucket binding from Cloudflare Workers */
  MEDIA_BUCKET?: R2Bucket;
  /** Environment name (development, staging, production) */
  ENVIRONMENT?: string;
  /** Cloudflare Account ID for R2 endpoint */
  R2_ACCOUNT_ID?: string;
  /** R2 API token Access Key ID */
  R2_ACCESS_KEY_ID?: string;
  /** R2 API token Secret Access Key */
  R2_SECRET_ACCESS_KEY?: string;
  /** R2 bucket name for media (e.g., codex-media-production) */
  R2_BUCKET_MEDIA?: string;
  /** Base URL for dev-cdn proxy (local development only, e.g. http://localhost:4100) */
  R2_PUBLIC_URL_BASE?: string;
  /** Stripe secret key for purchase verification */
  STRIPE_SECRET_KEY?: string;
  /** Database connection method (LOCAL_PROXY, NEON_BRANCH, PRODUCTION) */
  DB_METHOD?: string;
  /** Database URL for connections */
  DATABASE_URL?: string;
  /** Local proxy database URL (for LOCAL_PROXY mode) */
  DATABASE_URL_LOCAL_PROXY?: string;
}

/**
 * Factory function for dependency injection
 *
 * Used in API endpoints to create service instance with environment config.
 * Requires R2 signing credentials for presigned URL generation.
 *
 * @throws Error if required environment variables are missing
 */
export function createContentAccessService(env: ContentAccessEnv): {
  service: ContentAccessService;
  cleanup: () => Promise<void>;
} {
  const obs = new ObservabilityClient(
    SERVICE_NAME,
    env.ENVIRONMENT ?? 'development'
  );

  let r2: R2Signer;
  if (env.ENVIRONMENT === ENV_NAMES.DEVELOPMENT && env.R2_PUBLIC_URL_BASE) {
    r2 = new DevR2Signer(env.R2_PUBLIC_URL_BASE);
  } else {
    if (!env.MEDIA_BUCKET) {
      throw new Error('MEDIA_BUCKET binding is required');
    }
    if (!env.R2_ACCOUNT_ID) {
      throw new Error('R2_ACCOUNT_ID environment variable is required');
    }
    if (!env.R2_ACCESS_KEY_ID) {
      throw new Error('R2_ACCESS_KEY_ID environment variable is required');
    }
    if (!env.R2_SECRET_ACCESS_KEY) {
      throw new Error('R2_SECRET_ACCESS_KEY environment variable is required');
    }
    if (!env.R2_BUCKET_MEDIA) {
      throw new Error('R2_BUCKET_MEDIA environment variable is required');
    }

    const signingConfig: R2SigningConfig = {
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucketName: env.R2_BUCKET_MEDIA,
    };

    r2 = new R2Service(env.MEDIA_BUCKET, {}, signingConfig);
  }

  // Create per-request database client with WebSocket support for transactions
  const { db, cleanup } = createPerRequestDbClient(env);

  // Create Stripe client and PurchaseService
  const stripe = createStripeClient(env.STRIPE_SECRET_KEY || '');
  const purchaseService = new PurchaseService(
    { db, environment: env.ENVIRONMENT ?? 'development' },
    stripe
  );

  const service = new ContentAccessService({ db, r2, obs, purchaseService });

  // Return service with cleanup function
  return { service, cleanup };
}
