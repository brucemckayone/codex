import type { R2Bucket } from '@cloudflare/workers-types';
import { R2Service, type R2SigningConfig } from '@codex/cloudflare-clients';
import {
  CONTENT_ACCESS_TYPE,
  CONTENT_STATUS,
  ENV_NAMES,
  MEDIA_STATUS,
  MEDIA_TYPES,
  ORGANIZATION_ROLES,
  PURCHASE_STATUS,
  SUBSCRIPTION_STATUS,
  VIDEO_PROGRESS,
} from '@codex/constants';
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
import { createStripeClient, PurchaseService } from '@codex/purchase';
import {
  BaseService,
  type ServiceConfig,
  ValidationError,
} from '@codex/service-errors';
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
import { LOG_EVENTS, LOG_SEVERITY } from '../constants';
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
  /** How the user has access: 'purchased', 'membership', or 'subscription' */
  accessType: 'purchased' | 'membership' | 'subscription';
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

export interface ContentAccessServiceConfig extends ServiceConfig {
  r2: R2Signer;
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
export class ContentAccessService extends BaseService {
  private readonly r2: R2Signer;
  private readonly purchaseService: PurchaseService;

  constructor(config: ContentAccessServiceConfig) {
    super(config);
    this.r2 = config.r2;
    this.purchaseService = config.purchaseService;
  }

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
    this.obs.info('Getting streaming URL', {
      userId,
      contentId: input.contentId,
      expirySeconds: input.expirySeconds,
    });

    try {
      // Step 1 & 2: Verify access and fetch content/media data within transaction
      // Transaction ensures consistent snapshot for access verification
      const { r2Key, mediaType } = await this.db.transaction(
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
            this.obs.warn('Content not found or not accessible', {
              contentId: input.contentId,
              userId,
            });

            throw new ContentNotFoundError(input.contentId);
          }

          if (!contentRecord.mediaItem) {
            this.obs.warn('Content has no associated media item', {
              contentId: input.contentId,
              userId,
            });
            throw new ContentNotFoundError(input.contentId, {
              reason: 'no_media_item',
            });
          }

          // ── Reusable helper: check active subscription access ──────
          // Returns true if user has an active subscription to the org
          // that meets the content's minimum tier requirement.
          // When minimumTierId is null, any active subscription grants access.
          const checkSubscriptionAccess = async (
            orgId: string,
            minimumTierId: string | null
          ): Promise<boolean> => {
            const userSub = await tx.query.subscriptions.findFirst({
              where: and(
                eq(subscriptions.userId, userId),
                eq(subscriptions.organizationId, orgId),
                inArray(subscriptions.status, [
                  SUBSCRIPTION_STATUS.ACTIVE,
                  SUBSCRIPTION_STATUS.CANCELLING,
                ]),
                gt(subscriptions.currentPeriodEnd, new Date())
              ),
              with: { tier: true },
            });

            if (!userSub) return false;

            // No minimum tier set — any active subscription grants access
            if (!minimumTierId) {
              this.obs.info('Access granted via subscription (any tier)', {
                userId,
                contentId: input.contentId,
                subscriptionTier: userSub.tier.name,
              });
              return true;
            }

            // Minimum tier set — compare sortOrder
            const contentTier = await tx.query.subscriptionTiers.findFirst({
              where: eq(subscriptionTiers.id, minimumTierId),
            });

            if (
              contentTier &&
              userSub.tier.sortOrder >= contentTier.sortOrder
            ) {
              this.obs.info('Access granted via subscription', {
                userId,
                contentId: input.contentId,
                subscriptionTier: userSub.tier.name,
                contentMinTier: contentTier.name,
              });
              return true;
            }

            return false;
          };

          // ── Reusable helper: check org membership ──────────────────
          const checkOrgMembership = async (orgId: string) => {
            return tx.query.organizationMemberships.findFirst({
              where: and(
                eq(organizationMemberships.organizationId, orgId),
                eq(organizationMemberships.userId, userId),
                eq(organizationMemberships.status, 'active')
              ),
            });
          };

          // ── Reusable helper: check management membership ────────────
          // Only owner/admin/creator roles bypass payment requirements.
          // Regular 'member' and 'subscriber' roles must purchase or
          // subscribe to access paid/subscriber content.
          const MANAGEMENT_ROLES: string[] = [
            ORGANIZATION_ROLES.OWNER,
            ORGANIZATION_ROLES.ADMIN,
            ORGANIZATION_ROLES.CREATOR,
          ];

          const checkManagementMembership = async (orgId: string) => {
            return tx.query.organizationMemberships.findFirst({
              where: and(
                eq(organizationMemberships.organizationId, orgId),
                eq(organizationMemberships.userId, userId),
                eq(organizationMemberships.status, 'active'),
                inArray(organizationMemberships.role, MANAGEMENT_ROLES)
              ),
            });
          };

          // ── Access decision: branch on accessType ──────────────────

          // (a) Members-only: require active org membership, no purchase/subscription bypass
          if (contentRecord.accessType === 'members') {
            if (!contentRecord.organizationId) {
              throw new AccessDeniedError(userId, input.contentId, {
                reason: 'members_only_requires_org',
              });
            }

            const membership = await checkOrgMembership(
              contentRecord.organizationId
            );

            if (!membership) {
              this.obs.warn('Access denied - members-only content', {
                userId,
                contentId: input.contentId,
                organizationId: contentRecord.organizationId,
                securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
                severity: LOG_SEVERITY.MEDIUM,
                eventType: LOG_EVENTS.ACCESS_CONTROL,
              });
              throw new AccessDeniedError(userId, input.contentId, {
                organizationId: contentRecord.organizationId,
                reason: 'members_only',
              });
            }

            this.obs.info(
              'Access granted via membership (members-only content)',
              {
                userId,
                contentId: input.contentId,
                organizationId: contentRecord.organizationId,
                membershipRole: membership.role,
              }
            );
          }
          // (b) Subscribers-only: require active subscription (with optional tier check)
          else if (contentRecord.accessType === 'subscribers') {
            if (!contentRecord.organizationId) {
              throw new AccessDeniedError(userId, input.contentId, {
                reason: 'subscribers_only_requires_org',
              });
            }

            let granted = false;

            // Primary check: active subscription to the org
            const hasSubAccess = await checkSubscriptionAccess(
              contentRecord.organizationId,
              contentRecord.minimumTierId
            );

            if (hasSubAccess) {
              granted = true;
            }

            // Fallback: individual purchase (user may have bought it separately)
            if (!granted) {
              const hasPurchased = await this.purchaseService.verifyPurchase(
                input.contentId,
                userId
              );
              if (hasPurchased) {
                this.obs.info(
                  'Access granted via purchase (subscriber content)',
                  {
                    userId,
                    contentId: input.contentId,
                  }
                );
                granted = true;
              }
            }

            // Fallback: management membership (owner/admin/creator only)
            // Regular 'member' and 'subscriber' roles must subscribe or purchase
            if (!granted) {
              const membership = await checkManagementMembership(
                contentRecord.organizationId
              );
              if (membership) {
                this.obs.info(
                  'Access granted via management membership (subscriber content)',
                  {
                    userId,
                    contentId: input.contentId,
                    organizationId: contentRecord.organizationId,
                    membershipRole: membership.role,
                  }
                );
                granted = true;
              }
            }

            if (!granted) {
              this.obs.warn('Access denied - subscriber-only content', {
                userId,
                contentId: input.contentId,
                organizationId: contentRecord.organizationId,
                minimumTierId: contentRecord.minimumTierId,
                securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
                severity: LOG_SEVERITY.MEDIUM,
                eventType: LOG_EVENTS.ACCESS_CONTROL,
              });
              throw new AccessDeniedError(userId, input.contentId, {
                organizationId: contentRecord.organizationId,
                reason: 'subscribers_only',
              });
            }
          }
          // (c) Paid content: check purchase, then subscription, then membership
          else if (contentRecord.priceCents && contentRecord.priceCents > 0) {
            // Paid content - check purchase via PurchaseService
            const hasPurchased = await this.purchaseService.verifyPurchase(
              input.contentId,
              userId
            );

            if (hasPurchased) {
              this.obs.info('Access granted via purchase', {
                userId,
                contentId: input.contentId,
              });
            } else {
              // No purchase — check subscription tier access ONLY if content
              // is also subscriber-gated (has minimumTierId). Pure paid content
              // (accessType='paid', no minimumTierId) requires a purchase.
              let hasSubscriptionAccess = false;

              if (contentRecord.organizationId && contentRecord.minimumTierId) {
                hasSubscriptionAccess = await checkSubscriptionAccess(
                  contentRecord.organizationId,
                  contentRecord.minimumTierId
                );
              }

              if (!hasSubscriptionAccess) {
                // No subscription access — fall back to org membership check
                const contentOrgId = contentRecord.organizationId;

                if (!contentOrgId) {
                  // Personal content with no org - requires purchase
                  this.obs.warn(
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

                // Check if user is a management member (owner/admin/creator)
                // Regular 'member' and 'subscriber' roles must purchase or subscribe
                const membership =
                  await checkManagementMembership(contentOrgId);

                if (!membership) {
                  this.obs.warn(
                    'Access denied - no purchase and not management member',
                    {
                      userId,
                      contentId: input.contentId,
                      organizationId: contentOrgId,
                      priceCents: contentRecord.priceCents,
                      securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
                      severity: LOG_SEVERITY.MEDIUM,
                      eventType: LOG_EVENTS.ACCESS_CONTROL,
                    }
                  );
                  throw new AccessDeniedError(userId, input.contentId, {
                    priceCents: contentRecord.priceCents,
                    organizationId: contentOrgId,
                  });
                }

                this.obs.info('Access granted via management membership', {
                  userId,
                  contentId: input.contentId,
                  organizationId: contentOrgId,
                  membershipRole: membership.role,
                });
              } // end if (!hasSubscriptionAccess)
            }
          }
          // (d) Free content: grant access
          else {
            this.obs.info('Free content - access granted', {
              contentId: input.contentId,
            });
          }

          // Verify media is ready for streaming (status='ready' with transcoding outputs)
          const mediaStatus = contentRecord.mediaItem.status;
          if (mediaStatus !== MEDIA_STATUS.READY) {
            this.obs.warn('Media not ready for streaming', {
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
            this.obs.error('Media marked ready but missing HLS key', {
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
            this.obs.error('Invalid media type', {
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
        const streamingUrl = await this.r2.generateSignedUrl(
          r2Key,
          input.expirySeconds
        );
        const expiresAt = new Date(Date.now() + input.expirySeconds * 1000);

        this.obs.info('Streaming URL generated successfully', {
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
        this.obs.error('Failed to generate signed R2 URL', {
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
      this.handleError(error, 'getStreamingUrl');
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
    // Auto-complete if watched >= completion threshold
    const completionThreshold =
      input.durationSeconds * VIDEO_PROGRESS.COMPLETION_THRESHOLD;
    const isCompleted = input.positionSeconds >= completionThreshold;

    this.obs.info('Saving playback progress', {
      userId,
      contentId: input.contentId,
      positionSeconds: input.positionSeconds,
      durationSeconds: input.durationSeconds,
      completed: isCompleted,
    });

    // Upsert using unique constraint with optimistic concurrency control
    // Only update if new position is greater (prevents backwards seeking overwrites)
    await this.db
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

    this.obs.info('Playback progress saved', {
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
    const progress = await this.db.query.videoPlayback.findFirst({
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
    this.obs.info('Listing user library', {
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

    const MANAGEMENT_ROLES: string[] = [
      ORGANIZATION_ROLES.OWNER,
      ORGANIZATION_ROLES.ADMIN,
      ORGANIZATION_ROLES.CREATOR,
    ];

    const activeMemberships =
      input.accessType === 'purchased' || input.accessType === 'subscription'
        ? []
        : await this.db.query.organizationMemberships.findMany({
            where: and(...membershipConditions),
            columns: { organizationId: true, role: true },
          });
    const memberOrgIds = activeMemberships.map((m) => m.organizationId);

    // Partition memberships: management roles see all org content,
    // regular members only see free + members content
    const managementOrgIds = activeMemberships
      .filter((m) => MANAGEMENT_ROLES.includes(m.role))
      .map((m) => m.organizationId);
    const regularMemberOrgIds = activeMemberships
      .filter((m) => !MANAGEMENT_ROLES.includes(m.role))
      .map((m) => m.organizationId);

    // ── Step 1b: Resolve active subscriptions with tier info ─────────
    const activeSubscriptions =
      input.accessType === 'purchased' || input.accessType === 'membership'
        ? []
        : await this.db.query.subscriptions.findMany({
            where: and(
              eq(subscriptions.userId, userId),
              inArray(subscriptions.status, [
                SUBSCRIPTION_STATUS.ACTIVE,
                SUBSCRIPTION_STATUS.CANCELLING,
              ]),
              gt(subscriptions.currentPeriodEnd, new Date()),
              ...(input.organizationId
                ? [eq(subscriptions.organizationId, input.organizationId)]
                : [])
            ),
            with: { tier: true },
          });

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
      if (
        input.accessType === 'membership' ||
        input.accessType === 'subscription'
      ) {
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

      const baseFrom = this.db
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

      const countQuery = this.db
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
      if (
        input.accessType === 'purchased' ||
        input.accessType === 'subscription' ||
        memberOrgIds.length === 0
      ) {
        return { items: [] as UserLibraryItem[], count: 0 };
      }

      // Build role-aware org membership filter:
      // - Management roles (owner/admin/creator) see ALL content from their orgs
      // - Regular members only see 'free' and 'members' content from their orgs
      const membershipContentFilter = (() => {
        const parts: ReturnType<typeof and>[] = [];

        if (managementOrgIds.length > 0) {
          // Management roles: all content from these orgs
          parts.push(inArray(content.organizationId, managementOrgIds));
        }

        if (regularMemberOrgIds.length > 0) {
          // Regular members: only free + members content
          parts.push(
            and(
              inArray(content.organizationId, regularMemberOrgIds),
              inArray(content.accessType, [
                CONTENT_ACCESS_TYPE.FREE,
                CONTENT_ACCESS_TYPE.MEMBERS,
              ])
            )
          );
        }

        return parts.length === 1 ? parts[0]! : or(...parts)!;
      })();

      const conditions = [
        membershipContentFilter,
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

      const baseFrom = this.db
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

      const countQuery = this.db
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

    // ── Step 4b: Query subscription items ───────────────────────────
    const querySubscription = async () => {
      if (
        input.accessType === 'purchased' ||
        input.accessType === 'membership' ||
        activeSubscriptions.length === 0
      ) {
        return { items: [] as UserLibraryItem[], count: 0 };
      }

      // Build a tier-aware filter: for each subscription, include content
      // from that org where the user's tier sortOrder >= content's minimum tier
      // sortOrder (or content has no minimum tier).
      const subOrgIds = activeSubscriptions.map((s) => s.organizationId);

      // Build per-subscription tier conditions using SQL:
      // For each sub, content.organizationId = sub.orgId AND
      //   (content.minimumTierId IS NULL
      //    OR content.minimumTierId IN (tiers with sortOrder <= user's tier sortOrder))
      //
      // Since each subscription may be to a different org with a different tier,
      // we build an OR of per-subscription conditions.
      const subConditions = activeSubscriptions.map((sub) => {
        const tierSortOrder = sub.tier.sortOrder;
        return and(
          eq(content.organizationId, sub.organizationId),
          or(
            isNull(content.minimumTierId),
            // minimumTierId's sortOrder must be <= user's subscription tier sortOrder
            sql`${content.minimumTierId} IN (
              SELECT ${subscriptionTiers.id} FROM ${subscriptionTiers}
              WHERE ${subscriptionTiers.sortOrder} <= ${tierSortOrder}
                AND ${subscriptionTiers.organizationId} = ${sub.organizationId}
                AND ${subscriptionTiers.deletedAt} IS NULL
            )`
          )
        );
      });

      const conditions = [
        // Content must be subscriber-gated and published
        eq(content.accessType, CONTENT_ACCESS_TYPE.SUBSCRIBERS),
        eq(content.status, CONTENT_STATUS.PUBLISHED),
        isNull(content.deletedAt),
        // Must belong to one of the user's subscribed orgs (with tier check)
        or(...subConditions)!,
        // Exclude content the user already purchased (prevents duplicates)
        sql`${content.id} NOT IN (SELECT ${purchases.contentId} FROM ${purchases} WHERE ${purchases.customerId} = ${userId} AND ${purchases.status} = ${PURCHASE_STATUS.COMPLETED})`,
        // Exclude content from management orgs (owner/admin/creator see all via membership query).
        // Regular member/subscriber orgs are NOT excluded — their membership query only returns
        // free + members content, so there's no overlap with subscribers content here.
        ...(managementOrgIds.length > 0
          ? [
              sql`${content.organizationId} NOT IN (${sql.join(
                managementOrgIds.map((id) => sql`${id}`),
                sql`, `
              )})`,
            ]
          : []),
        ...contentFilters,
        ...progressFilters,
      ];

      const sortClause =
        input.sortBy === 'title'
          ? content.title
          : input.sortBy === 'duration'
            ? sql`COALESCE(${mediaItems.durationSeconds}, 0)`
            : content.createdAt;

      const baseFrom = this.db
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

      const countQuery = this.db
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
        accessType: 'subscription' as const,
        purchase: null,
        progress: mapProgress(row),
      }));

      return { items, count: countResult[0]?.count ?? 0 };
    };

    // ── Step 5: Execute all queries in parallel ──────────────────────
    const [purchaseResult, membershipResult, subscriptionResult] =
      await Promise.all([
        queryPurchased(),
        queryMembership(),
        querySubscription(),
      ]);

    // ── Step 6: Merge, sort, and paginate ─────────────────────────────
    // Collect all sources that contributed items.
    const sources = [purchaseResult, membershipResult, subscriptionResult];
    const activeSources = sources.filter((s) => s.count > 0);

    // When a specific accessType filter is applied or only one source has
    // items, the DB already handled pagination — return directly.
    const filteredAccessType =
      input.accessType === 'purchased' ||
      input.accessType === 'membership' ||
      input.accessType === 'subscription';

    if (filteredAccessType || activeSources.length <= 1) {
      const result = filteredAccessType
        ? input.accessType === 'purchased'
          ? purchaseResult
          : input.accessType === 'membership'
            ? membershipResult
            : subscriptionResult
        : (activeSources[0] ?? purchaseResult);
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

    // Multiple sources have items — merge sort (each fetched with LIMIT/OFFSET
    // from their own source, so we merge and trim to page size)
    const totalCount = sources.reduce((sum, s) => sum + s.count, 0);
    const allItems = sources.flatMap((s) => s.items);

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
  let r2: R2Signer;
  if (env.ENVIRONMENT === ENV_NAMES.DEVELOPMENT && env.R2_PUBLIC_URL_BASE) {
    r2 = new DevR2Signer(env.R2_PUBLIC_URL_BASE);
  } else {
    if (!env.MEDIA_BUCKET) {
      throw new ValidationError('MEDIA_BUCKET binding is required', {
        field: 'MEDIA_BUCKET',
      });
    }
    if (!env.R2_ACCOUNT_ID) {
      throw new ValidationError(
        'R2_ACCOUNT_ID environment variable is required',
        {
          field: 'R2_ACCOUNT_ID',
        }
      );
    }
    if (!env.R2_ACCESS_KEY_ID) {
      throw new ValidationError(
        'R2_ACCESS_KEY_ID environment variable is required',
        {
          field: 'R2_ACCESS_KEY_ID',
        }
      );
    }
    if (!env.R2_SECRET_ACCESS_KEY) {
      throw new ValidationError(
        'R2_SECRET_ACCESS_KEY environment variable is required',
        {
          field: 'R2_SECRET_ACCESS_KEY',
        }
      );
    }
    if (!env.R2_BUCKET_MEDIA) {
      throw new ValidationError(
        'R2_BUCKET_MEDIA environment variable is required',
        {
          field: 'R2_BUCKET_MEDIA',
        }
      );
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
  const environment = env.ENVIRONMENT ?? 'development';
  const stripe = createStripeClient(env.STRIPE_SECRET_KEY || '');
  const purchaseService = new PurchaseService({ db, environment }, stripe);
  const service = new ContentAccessService({
    db,
    environment,
    r2,
    purchaseService,
  });

  // Return service with cleanup function
  return { service, cleanup };
}
