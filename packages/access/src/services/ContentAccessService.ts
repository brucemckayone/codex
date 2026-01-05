import type { R2Bucket } from '@cloudflare/workers-types';
import { R2Service, type R2SigningConfig } from '@codex/cloudflare-clients';
import type { DatabaseWs } from '@codex/database';
import { createPerRequestDbClient } from '@codex/database';
import {
  content,
  organizationMemberships,
  purchases,
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
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  AccessDeniedError,
  ContentNotFoundError,
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
 * User library item with content, purchase, and progress information
 */
interface UserLibraryItem {
  content: {
    id: string;
    title: string;
    description: string;
    thumbnailUrl: string | null;
    contentType: string;
    durationSeconds: number;
  };
  purchase: {
    purchasedAt: string;
    priceCents: number;
  };
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
              eq(content.status, 'published'),
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
              // No purchase - check organization membership
              const contentOrgId = contentRecord.organizationId;

              if (!contentOrgId) {
                // Personal content with no org - requires purchase
                obs.warn(
                  'Access denied - paid personal content requires purchase',
                  {
                    userId,
                    contentId: input.contentId,
                    priceCents: contentRecord.priceCents,
                    securityEvent: 'UNAUTHORIZED_ACCESS_ATTEMPT',
                    severity: 'MEDIUM',
                    eventType: 'access_control',
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
                  securityEvent: 'UNAUTHORIZED_ACCESS_ATTEMPT',
                  severity: 'MEDIUM',
                  eventType: 'access_control',
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
            }
          } else {
            obs.info('Free content - access granted', {
              contentId: input.contentId,
            });
          }

          // Verify media is ready for streaming (status='ready' with transcoding outputs)
          const mediaStatus = contentRecord.mediaItem.status;
          if (mediaStatus !== 'ready') {
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

          if (!['video', 'audio'].includes(mediaType)) {
            obs.error('Invalid media type', {
              mediaType,
              contentId: input.contentId,
              mediaItemId: contentRecord.mediaItem.id,
            });
            throw new Error('INVALID_MEDIA_TYPE');
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

    // Auto-complete if watched >= 95%
    const completionThreshold = input.durationSeconds * 0.95;
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
    });

    const offset = (input.page - 1) * input.limit;

    // Step 1: Get purchases with content and media details
    const purchaseRecords = await db.query.purchases.findMany({
      where: and(
        eq(purchases.customerId, userId),
        eq(purchases.status, 'completed')
      ),
      with: {
        content: {
          with: {
            mediaItem: true,
          },
        },
      },
      orderBy: [desc(purchases.createdAt)],
      limit: input.limit + 1, // Fetch one extra to check if there's more
      offset,
    });

    // Check if there are more pages
    const hasMore = purchaseRecords.length > input.limit;
    const resolvedPurchases = hasMore
      ? purchaseRecords.slice(0, input.limit)
      : purchaseRecords;

    if (resolvedPurchases.length === 0) {
      return {
        items: [],
        pagination: {
          page: input.page,
          limit: input.limit,
          total: 0,
          totalPages: 0,
        },
      };
    }

    // Step 2: Get playback progress for all content in batch
    const contentIds = resolvedPurchases.map((p) => p.contentId);
    const progressRecords = await db.query.videoPlayback.findMany({
      where: and(
        eq(videoPlayback.userId, userId),
        inArray(videoPlayback.contentId, contentIds)
      ),
    });

    const progressMap = new Map(progressRecords.map((p) => [p.contentId, p]));

    // Step 3: Build response items
    let items = resolvedPurchases
      .filter((p) => p.content) // Filter out purchases with no content
      .map((purchase) => {
        const progress = progressMap.get(purchase.contentId);
        const { content } = purchase;
        const { mediaItem } = content;

        return {
          content: {
            id: content.id,
            title: content.title,
            description: content.description || '',
            thumbnailUrl:
              content.thumbnailUrl ?? mediaItem?.thumbnailKey ?? null,
            contentType: mediaItem?.mediaType ?? 'video',
            durationSeconds: mediaItem?.durationSeconds ?? 0,
          },
          purchase: {
            purchasedAt: purchase.createdAt.toISOString(),
            priceCents: purchase.amountPaidCents,
          },
          progress: progress
            ? {
                positionSeconds: progress.positionSeconds,
                durationSeconds: progress.durationSeconds,
                completed: progress.completed,
                percentComplete: Math.round(
                  (progress.positionSeconds / progress.durationSeconds) * 100
                ),
                updatedAt: progress.updatedAt.toISOString(),
              }
            : null,
        };
      });

    // Step 4: Apply filter
    items = items.filter((item) => {
      if (input.filter === 'in-progress') {
        return item.progress && !item.progress.completed;
      }
      if (input.filter === 'completed') {
        return item.progress?.completed === true;
      }
      return true; // 'all'
    });

    // Step 5: Apply sort (after filter for accuracy)
    if (input.sortBy === 'title') {
      items.sort((a, b) => a.content.title.localeCompare(b.content.title));
    } else if (input.sortBy === 'duration') {
      items.sort(
        (a, b) =>
          (b.content.durationSeconds ?? 0) - (a.content.durationSeconds ?? 0)
      );
    }
    // 'recent' is already sorted by purchase.createdAt DESC

    const totalPages = Math.ceil(items.length / input.limit);

    return {
      items,
      pagination: {
        page: input.page,
        limit: input.limit,
        total: items.length,
        totalPages,
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
  // Validate required environment variables
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

  const obs = new ObservabilityClient(
    'content-access-service',
    env.ENVIRONMENT ?? 'development'
  );

  const signingConfig: R2SigningConfig = {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucketName: env.R2_BUCKET_MEDIA,
  };

  const r2 = new R2Service(env.MEDIA_BUCKET, {}, signingConfig);

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
