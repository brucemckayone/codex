import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types';
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
  organizationFollowers,
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
  ForbiddenError,
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
import { AccessRevocation } from './access-revocation';

/**
 * Default TTL (in seconds) for presigned streaming URLs.
 *
 * Bounds how long a signed R2 URL remains valid after issuance, which is
 * the maximum window during which a revoked user (cancelled subscription,
 * failed payment, refund) can still stream content with a URL minted before
 * revocation. Cryptographic presigned URLs cannot be invalidated once issued,
 * so this TTL is the primary exposure-after-revocation control.
 *
 * 600s (10 min) balances:
 *   - Short enough that revocation takes effect within one client refresh cycle.
 *   - Long enough to cover a typical HLS segment fetch window without the
 *     client re-requesting a new URL mid-stream (HLS.js re-fetches the
 *     master playlist URL on manifest refresh, not per-segment).
 *
 * Callers may override by passing `input.expirySeconds` — bounded by the
 * Zod schema (`getStreamingUrlSchema`) to [300, 7200].
 *
 * See docs/subscription-cache-audit/phase-2-followup.md — Phase 3.
 */
export const DEFAULT_STREAMING_URL_TTL_SECONDS = 600;

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
    organizationId: string | null;
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
  /**
   * Optional access revocation helper — when provided, `savePlaybackProgress`
   * (and, in a follow-up, `getStreamingUrl`) short-circuits on a revocation
   * key hit before performing any DB work.
   *
   * Injected by the service registry when `CACHE_KV` is bound. Omitted in
   * environments without KV (narrow unit tests, legacy factory callers);
   * in those paths the DB-level access check still runs.
   */
  revocation?: AccessRevocation;
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
  private readonly revocation: AccessRevocation | undefined;

  constructor(config: ContentAccessServiceConfig) {
    super(config);
    this.r2 = config.r2;
    this.purchaseService = config.purchaseService;
    this.revocation = config.revocation;
  }

  /**
   * Check whether a user currently has access to a piece of content.
   *
   * This is the boolean equivalent of the access-decision logic embedded in
   * `getStreamingUrl`'s transaction — factored out so the progress save path
   * (and future callers) can gate writes without duplicating the rules. It
   * deliberately does NOT throw `AccessDeniedError` and does NOT generate
   * signed URLs; it only answers "does this (userId, contentId) pair pass
   * the current access rules?".
   *
   * Not run inside a transaction — progress saves don't require a snapshot
   * across the access read + the videoPlayback upsert. A race where access
   * is revoked between this check and the upsert is acceptable (the next
   * heartbeat will be blocked) and bounded by the short KV TTL on the
   * revocation key.
   *
   * Returns `false` for:
   *   - Content not found / unpublished / soft-deleted (treated as no access)
   *   - Team-only content when user lacks a management role
   *   - Followers-only content when user is neither follower nor management.
   *     Note: an active subscription does NOT grant follower-only access on
   *     its own — a subscriber who wants to see follower content must also
   *     explicitly follow the org (the follow action is free, so this is a
   *     low-friction ask rather than a paywall).
   *   - Subscribers-only content when user has neither an active subscription
   *     meeting the minimum tier, a purchase, nor management
   *   - Paid content when user has neither purchased nor (via tier) subscribed
   *     nor holds a management role
   *
   * Returns `true` for free content the user can see, and for any of the
   * above paths when satisfied.
   */
  async hasContentAccess(userId: string, contentId: string): Promise<boolean> {
    const contentRecord = await this.db.query.content.findFirst({
      where: and(
        eq(content.id, contentId),
        eq(content.status, CONTENT_STATUS.PUBLISHED),
        isNull(content.deletedAt)
      ),
      columns: {
        id: true,
        organizationId: true,
        accessType: true,
        priceCents: true,
        minimumTierId: true,
      },
    });

    if (!contentRecord) {
      // Missing/unpublished content → treat as no access. Don't leak the
      // distinction between "doesn't exist" and "you can't see it" at this
      // layer — the caller translates the boolean.
      return false;
    }

    const orgId = contentRecord.organizationId;

    // Inline reusable helpers — mirror the branches in getStreamingUrl.
    const MANAGEMENT_ROLES: string[] = [
      ORGANIZATION_ROLES.OWNER,
      ORGANIZATION_ROLES.ADMIN,
      ORGANIZATION_ROLES.CREATOR,
    ];

    const hasManagementMembership = async (
      organizationId: string
    ): Promise<boolean> => {
      const row = await this.db.query.organizationMemberships.findFirst({
        where: and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, 'active'),
          inArray(organizationMemberships.role, MANAGEMENT_ROLES)
        ),
        columns: { id: true },
      });
      return !!row;
    };

    const hasFollower = async (organizationId: string): Promise<boolean> => {
      const row = await this.db.query.organizationFollowers.findFirst({
        where: and(
          eq(organizationFollowers.organizationId, organizationId),
          eq(organizationFollowers.userId, userId)
        ),
        columns: { id: true },
      });
      return !!row;
    };

    const hasSubscriptionAccess = async (
      organizationId: string,
      minimumTierId: string | null
    ): Promise<boolean> => {
      const userSub = await this.db.query.subscriptions.findFirst({
        where: and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.organizationId, organizationId),
          inArray(subscriptions.status, [
            SUBSCRIPTION_STATUS.ACTIVE,
            SUBSCRIPTION_STATUS.CANCELLING,
          ]),
          gt(subscriptions.currentPeriodEnd, new Date())
        ),
        with: { tier: true },
      });
      if (!userSub) return false;
      if (!minimumTierId) return true;
      const contentTier = await this.db.query.subscriptionTiers.findFirst({
        where: eq(subscriptionTiers.id, minimumTierId),
        columns: { sortOrder: true },
      });
      if (!contentTier) return false;
      return userSub.tier.sortOrder >= contentTier.sortOrder;
    };

    // Branch on accessType — mirrors the decision tree in getStreamingUrl.
    if (contentRecord.accessType === CONTENT_ACCESS_TYPE.TEAM) {
      if (!orgId) return false;
      return hasManagementMembership(orgId);
    }

    if (contentRecord.accessType === CONTENT_ACCESS_TYPE.FOLLOWERS) {
      if (!orgId) return false;
      if (await hasFollower(orgId)) return true;
      // Subscription does NOT satisfy follower-only access on its own — the
      // creator is rewarding the follow action specifically, and following
      // is free. Subscribers who want follower content must also follow.
      return hasManagementMembership(orgId);
    }

    if (contentRecord.accessType === CONTENT_ACCESS_TYPE.SUBSCRIBERS) {
      if (!orgId) return false;
      if (await hasSubscriptionAccess(orgId, contentRecord.minimumTierId)) {
        return true;
      }
      if (await this.purchaseService.verifyPurchase(contentId, userId)) {
        return true;
      }
      return hasManagementMembership(orgId);
    }

    // Paid content (priceCents > 0) — check purchase, optional tier, membership.
    if (contentRecord.priceCents && contentRecord.priceCents > 0) {
      if (await this.purchaseService.verifyPurchase(contentId, userId)) {
        return true;
      }
      if (orgId && contentRecord.minimumTierId) {
        if (await hasSubscriptionAccess(orgId, contentRecord.minimumTierId)) {
          return true;
        }
      }
      if (!orgId) return false;
      return hasManagementMembership(orgId);
    }

    // Free content with no price — access granted.
    return true;
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
    streamingUrl: string | null;
    waveformUrl: string | null;
    expiresAt: Date;
    contentType: 'video' | 'audio' | 'written';
    /**
     * HLS variants ready to stream (e.g. `['1080p', '720p', '480p', '360p']`).
     * Surfaced so the player can render a manual quality picker; omitted
     * when the media item has no recorded variants, or for written content.
     */
    readyVariants?: string[];
  }> {
    // Resolve the TTL once. The Zod schema already applies a default when
    // input flows through `procedure()`, but programmatic callers that
    // construct `GetStreamingUrlInput` directly may omit `expirySeconds`;
    // fall back to the module-level constant so the safe default is
    // enforced at the service boundary regardless of entry path.
    const expirySeconds =
      input.expirySeconds ?? DEFAULT_STREAMING_URL_TTL_SECONDS;

    this.obs.info('Getting streaming URL', {
      userId,
      contentId: input.contentId,
      expirySeconds,
    });

    try {
      // ── Access revocation short-circuit ─────────────────────────────
      // KV revocation check runs BEFORE the DB transaction. A warm KV read
      // (~0.5ms) is dramatically cheaper than opening a read-only transaction
      // and issuing the access-decision queries, so any revocation hit
      // rejects without touching the DB. Mirrors the sibling gate in
      // `savePlaybackProgress` (see Phase 4.1 of
      // docs/subscription-cache-audit/phase-2-followup.md).
      //
      // This runs only when `this.revocation` is wired (i.e. CACHE_KV is
      // bound). Standalone factory callers that omit the KV binding skip
      // this check silently — the DB-level access decision still catches
      // unauthorized access inside the transaction below.
      if (this.revocation) {
        const contentRow = await this.db.query.content.findFirst({
          where: and(
            eq(content.id, input.contentId),
            isNull(content.deletedAt)
          ),
          columns: { organizationId: true },
        });

        // Personal content (no organizationId) can't be revoked at the org
        // scope — fall through to the transaction below. The content row
        // may also be missing entirely (not found / deleted); let the
        // transaction surface `ContentNotFoundError` with consistent
        // context rather than duplicating the 404 path here.
        const orgId = contentRow?.organizationId ?? null;
        if (orgId) {
          const revocation = await this.revocation.isRevoked(userId, orgId);
          if (revocation) {
            this.obs.warn('getStreamingUrl blocked — access revoked', {
              userId,
              contentId: input.contentId,
              organizationId: orgId,
              reason: revocation.reason,
              securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
              severity: LOG_SEVERITY.MEDIUM,
              eventType: LOG_EVENTS.ACCESS_CONTROL,
            });
            throw new AccessDeniedError(userId, input.contentId, {
              message: 'Access revoked',
              reason: revocation.reason,
              organizationId: orgId,
            });
          }
        }
      }

      // Step 1 & 2: Verify access and fetch content/media data within transaction
      // Transaction ensures consistent snapshot for access verification
      const { r2Key, mediaType, waveformKey, readyVariants } =
        await this.db.transaction(
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

            // NOTE: Media item existence is NOT checked here. Written content
            // (articles) has no media item but still requires the same access
            // verification below so the body can be unlocked on the page.
            // Media-specific validation (status=ready, HLS key, mediaType)
            // only runs after the access check passes AND a media item exists.

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

            // ── Reusable helper: check follower relationship ────────────
            const checkFollower = async (orgId: string) => {
              return tx.query.organizationFollowers.findFirst({
                where: and(
                  eq(organizationFollowers.organizationId, orgId),
                  eq(organizationFollowers.userId, userId)
                ),
              });
            };

            // ── Access decision: branch on accessType ──────────────────

            // (a) Team-only: require management role (owner/admin/creator)
            if (contentRecord.accessType === 'team') {
              if (!contentRecord.organizationId) {
                throw new AccessDeniedError(userId, input.contentId, {
                  reason: 'team_only_requires_org',
                });
              }

              const membership = await checkManagementMembership(
                contentRecord.organizationId
              );

              if (!membership) {
                this.obs.warn('Access denied - team-only content', {
                  userId,
                  contentId: input.contentId,
                  organizationId: contentRecord.organizationId,
                  securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
                  severity: LOG_SEVERITY.MEDIUM,
                  eventType: LOG_EVENTS.ACCESS_CONTROL,
                });
                throw new AccessDeniedError(userId, input.contentId, {
                  organizationId: contentRecord.organizationId,
                  reason: 'team_only',
                });
              }

              this.obs.info(
                'Access granted via management role (team content)',
                {
                  userId,
                  contentId: input.contentId,
                  organizationId: contentRecord.organizationId,
                  membershipRole: membership.role,
                }
              );
            }
            // (b) Followers-only: require follower or management role.
            // Subscription alone does NOT grant follower-only access — the
            // creator is rewarding the (free) follow action, and subscribers
            // must follow separately to see this content. Keeps the two
            // relationships independent: paying doesn't auto-subscribe the
            // user to the org's follower feed, and a follower doesn't have
            // to pay to see follower-tagged posts.
            else if (contentRecord.accessType === 'followers') {
              if (!contentRecord.organizationId) {
                throw new AccessDeniedError(userId, input.contentId, {
                  reason: 'followers_only_requires_org',
                });
              }

              let granted = false;
              const orgId = contentRecord.organizationId;

              // Primary check: is user a follower?
              const follower = await checkFollower(orgId);
              if (follower) {
                this.obs.info(
                  'Access granted via follower (followers content)',
                  {
                    userId,
                    contentId: input.contentId,
                    organizationId: orgId,
                  }
                );
                granted = true;
              }

              // Fallback: management membership (team implicitly has access)
              if (!granted) {
                const membership = await checkManagementMembership(orgId);
                if (membership) {
                  this.obs.info(
                    'Access granted via management role (followers content)',
                    {
                      userId,
                      contentId: input.contentId,
                      organizationId: orgId,
                      membershipRole: membership.role,
                    }
                  );
                  granted = true;
                }
              }

              if (!granted) {
                this.obs.warn('Access denied - followers-only content', {
                  userId,
                  contentId: input.contentId,
                  organizationId: orgId,
                  securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
                  severity: LOG_SEVERITY.MEDIUM,
                  eventType: LOG_EVENTS.ACCESS_CONTROL,
                });
                throw new AccessDeniedError(userId, input.contentId, {
                  organizationId: orgId,
                  reason: 'followers_only',
                });
              }
            }
            // (c) Subscribers-only: require active subscription (with optional tier check)
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

                if (
                  contentRecord.organizationId &&
                  contentRecord.minimumTierId
                ) {
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

            // Access check passed. If content has no media item, it's a
            // written article — return a null-URL response so the caller
            // knows access is granted but there's nothing to stream.
            if (!contentRecord.mediaItem) {
              return {
                r2Key: null,
                mediaType: 'written' as const,
                waveformKey: null,
                readyVariants: null,
              };
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

            // Return data for R2 signing (outside transaction).
            // `readyVariants` is surfaced so the client can render a manual
            // quality picker over HLS.js adaptive selection. Falls through as
            // null when the media item has no recorded variants (e.g. during a
            // partial transcode; the HLS master still works, we just can't
            // enumerate the rungs).
            return {
              r2Key,
              mediaType: mediaType as 'video' | 'audio',
              waveformKey: contentRecord.mediaItem.waveformKey,
              readyVariants: contentRecord.mediaItem.readyVariants ?? null,
            };
          },
          {
            isolationLevel: 'read committed', // Consistent snapshot for access verification
            accessMode: 'read only', // All operations are reads
          }
        );

      // Written content: access granted, no stream to sign.
      if (mediaType === 'written' || r2Key === null) {
        const expiresAt = new Date(Date.now() + expirySeconds * 1000);
        this.obs.info('Access granted for written content (no stream)', {
          userId,
          contentId: input.contentId,
        });
        return {
          streamingUrl: null,
          waveformUrl: null,
          expiresAt,
          contentType: 'written' as const,
        };
      }

      // Step 3: Generate signed R2 URL (OUTSIDE transaction - external API call)
      try {
        const streamingUrl = await this.r2.generateSignedUrl(
          r2Key,
          expirySeconds
        );

        const waveformUrl =
          mediaType === 'audio' && waveformKey
            ? await this.r2.generateSignedUrl(waveformKey, expirySeconds)
            : null;

        const expiresAt = new Date(Date.now() + expirySeconds * 1000);

        this.obs.info('Streaming URL generated successfully', {
          userId,
          contentId: input.contentId,
          contentType: mediaType,
          hasWaveform: !!waveformUrl,
          expiresAt: expiresAt.toISOString(),
        });

        return {
          streamingUrl,
          waveformUrl,
          expiresAt,
          contentType: mediaType,
          // `readyVariants` may be null on legacy / partially-transcoded items —
          // convert to `undefined` so the HTTP layer can drop it from the JSON
          // envelope via its optional() schema instead of emitting null.
          readyVariants: readyVariants ?? undefined,
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
   * Access gate (MANDATORY — see docs/subscription-cache-audit/phase-2-followup.md Phase 4.1):
   *   1. Resolve content's organizationId.
   *   2. If `AccessRevocation.isRevoked(userId, orgId)` returns a revocation,
   *      throw `ForbiddenError('Access revoked', { reason })`. This closes
   *      the window where a cancelled/refunded user continues to POST
   *      heartbeats and accidentally restores "continue watching" entries
   *      after their subscription ends.
   *   3. If `hasContentAccess(userId, contentId)` is false, throw
   *      `ForbiddenError('No active access for this content')`.
   *   4. Only then run the upsert.
   *
   * The two checks are independent — either can reject. Revocation is
   * checked first because it's a cheap KV read and catches the common case
   * (webhook just fired, DB subscription row may still look ACTIVE for up
   * to 30s of replication lag) without any DB round-trip.
   *
   * @param userId - Authenticated user ID
   * @param input - Content ID, position, duration, completed flag
   * @throws {ForbiddenError} Access revoked, or user lacks access to content
   */
  async savePlaybackProgress(
    userId: string,
    input: SavePlaybackProgressInput
  ): Promise<void> {
    // ── Access gate ────────────────────────────────────────────────────
    // (1) KV revocation check — if revocation helper is wired, fetch the
    // content's orgId and check the block list before doing any DB writes.
    // The orgId lookup uses `this.db` (the per-request client) and reads
    // only the two columns the check needs.
    if (this.revocation) {
      const contentRow = await this.db.query.content.findFirst({
        where: and(eq(content.id, input.contentId), isNull(content.deletedAt)),
        columns: { organizationId: true },
      });

      // Personal content (no organizationId) can't be revoked at the org
      // scope; fall through to the DB-level access check below.
      const orgId = contentRow?.organizationId ?? null;
      if (orgId) {
        const revocation = await this.revocation.isRevoked(userId, orgId);
        if (revocation) {
          this.obs.warn('savePlaybackProgress blocked — access revoked', {
            userId,
            contentId: input.contentId,
            organizationId: orgId,
            reason: revocation.reason,
          });
          throw new ForbiddenError('Access revoked', {
            reason: revocation.reason,
            contentId: input.contentId,
            organizationId: orgId,
          });
        }
      }
    }

    // (2) DB-level access check — covers cancelled subscriptions, expired
    // periods, content the user never had access to in the first place,
    // and any path the revocation list doesn't cover (e.g. personal content).
    const hasAccess = await this.hasContentAccess(userId, input.contentId);
    if (!hasAccess) {
      this.obs.warn('savePlaybackProgress blocked — no active access', {
        userId,
        contentId: input.contentId,
      });
      throw new ForbiddenError('No active access for this content', {
        contentId: input.contentId,
      });
    }

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
            where: and(
              ...membershipConditions,
              inArray(organizationMemberships.role, MANAGEMENT_ROLES)
            ),
            columns: { organizationId: true, role: true },
          });

    // Only management roles (owner/admin/creator) populate the library's
    // "membership" bucket. Regular 'member' / 'subscriber' roles are handled
    // by the subscription query (if subscribed) — they don't pull content
    // into library just for existing.
    const managementOrgIds = activeMemberships.map((m) => m.organizationId);

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
          orgId: content.organizationId,
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
          organizationId: row.orgId,
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

    // ── Step 4: Query membership items ─────────────────────────────────
    // Library membership = content the user has via a MANAGEMENT relationship
    // with an org (owner/admin/creator). Free + follower content from orgs the
    // user merely follows is publicly browseable and does not belong in
    // "my library" — followers haven't acquired anything, they're just opted-in
    // to see it on the org's pages. Including it here would pollute every
    // subscriber's/follower's library with the full free catalogue.
    const queryMembership = async () => {
      if (
        input.accessType === 'purchased' ||
        input.accessType === 'subscription' ||
        managementOrgIds.length === 0
      ) {
        return { items: [] as UserLibraryItem[], count: 0 };
      }

      // Management roles see ALL content from orgs they manage.
      const membershipContentFilter = inArray(
        content.organizationId,
        managementOrgIds
      );

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
          orgId: content.organizationId,
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
          organizationId: row.orgId,
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
        // Content a subscription grants access to — either explicitly tagged
        // `accessType='subscribers'`, or tier-gated paid content
        // (`accessType='paid'` with a `minimumTierId` set). This mirrors the
        // streaming-access rule in getStreamingUrl() so anything a subscriber
        // can actually stream shows in their library. Paid content WITHOUT a
        // minimumTierId is still gated behind purchase — it never appears
        // here. Per-org tier-sortOrder check below (subConditions) decides
        // whether this user's tier is high enough for any given item.
        or(
          eq(content.accessType, CONTENT_ACCESS_TYPE.SUBSCRIBERS),
          and(
            eq(content.accessType, CONTENT_ACCESS_TYPE.PAID),
            sql`${content.minimumTierId} IS NOT NULL`
          )
        )!,
        eq(content.status, CONTENT_STATUS.PUBLISHED),
        isNull(content.deletedAt),
        // Must belong to one of the user's subscribed orgs (with tier check)
        or(...subConditions)!,
        // Exclude content the user already purchased (prevents duplicates)
        sql`${content.id} NOT IN (SELECT ${purchases.contentId} FROM ${purchases} WHERE ${purchases.customerId} = ${userId} AND ${purchases.status} = ${PURCHASE_STATUS.COMPLETED})`,
        // Exclude content from management orgs (owner/admin/creator see
        // all their org's content via the membership query).
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
          orgId: content.organizationId,
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
          organizationId: row.orgId,
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
  /** KV namespace for access revocation block list (optional) */
  CACHE_KV?: KVNamespace;
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
  const revocation = env.CACHE_KV
    ? new AccessRevocation(env.CACHE_KV)
    : undefined;

  const service = new ContentAccessService({
    db,
    environment,
    r2,
    purchaseService,
    revocation,
  });

  // Return service with cleanup function
  return { service, cleanup };
}
