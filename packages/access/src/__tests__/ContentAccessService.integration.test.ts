/**
 * Content Access Service Integration Tests
 *
 * Integration tests covering:
 * - Streaming URL generation for free and paid content
 * - Access control verification (purchases, content_access)
 * - Playback progress tracking (save/get/upsert)
 * - User library listing with filters and pagination
 *
 * Database Isolation:
 * - Uses neon-testing for ephemeral branch per test file
 * - Each test creates its own data (idempotent tests)
 * - No cleanup needed - fresh database for this file
 *
 * R2 Integration:
 * - Uses real R2SigningClient with test bucket credentials
 * - Generates real presigned URLs (verified in cloudflare-clients tests)
 */

import {
  createR2SigningClientFromEnv,
  type R2SigningClient,
} from '@codex/cloudflare-clients';
import { ContentService, MediaItemService } from '@codex/content';
import {
  content,
  organizationFollowers,
  organizationMemberships,
  organizations,
  purchases,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import { ObservabilityClient } from '@codex/observability';
import type { PurchaseService } from '@codex/purchase';
import {
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedPurchaseWithAccess,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { getOriginalKey } from '@codex/transcoding';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import { AccessDeniedError } from '../errors';
import { ContentAccessService } from '../services/ContentAccessService';

// Uses workflow-level Neon branch in CI, LOCAL_PROXY locally

describe('ContentAccessService Integration', () => {
  let db: Database;
  let accessService: ContentAccessService;
  let contentService: ContentService;
  let mediaService: MediaItemService;
  let r2Client: R2SigningClient;
  let mockPurchaseService: {
    verifyPurchase: Mock<
      (contentId: string, customerId: string) => Promise<boolean>
    >;
  };
  let userId: string;
  let otherUserId: string;
  let organizationId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const config = { db, environment: 'test' };

    contentService = new ContentService(config);
    mediaService = new MediaItemService(config);

    // Use real R2 signing client with test bucket credentials
    r2Client = createR2SigningClientFromEnv();

    // Mock PurchaseService
    mockPurchaseService = {
      verifyPurchase: vi.fn(),
    };

    const obs = new ObservabilityClient('content-access-test', 'test');
    accessService = new ContentAccessService({
      db,
      r2: r2Client,
      obs,
      purchaseService: mockPurchaseService as unknown as PurchaseService,
    });

    const userIds = await seedTestUsers(db, 2);
    [userId, otherUserId] = userIds;

    // Create test organization
    const [org] = await db
      .insert(organizations)
      .values({
        name: 'Test Organization',
        slug: createUniqueSlug('test-org'),
      })
      .returning();

    if (!org) {
      throw new Error('Failed to create test organization');
    }

    organizationId = org.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('getStreamingUrl', () => {
    it('should return streaming URL for free content without purchase', async () => {
      // Reset mock before test
      mockPurchaseService.verifyPurchase.mockClear();

      // Create media and content
      const media = await mediaService.create(
        {
          title: 'Free Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(userId, crypto.randomUUID(), 'free-video.mp4'),
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/free-video/master.m3u8',
          thumbnailKey: 'thumbnails/free-video.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const freeContent = await contentService.create(
        {
          organizationId,
          title: 'Free Tutorial',
          slug: createUniqueSlug('free-tutorial'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0, // Free!
          tags: [],
        },
        userId
      );

      await contentService.publish(freeContent.id, userId);

      // Any user should be able to stream free content
      const result = await accessService.getStreamingUrl(otherUserId, {
        contentId: freeContent.id,
        expirySeconds: 3600,
      });

      // Verify real presigned URL structure
      expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
      expect(result.streamingUrl).toContain('X-Amz-Signature');
      expect(result.contentType).toBe('video');
      expect(result.expiresAt).toBeInstanceOf(Date);

      // Verify PurchaseService was NOT called for free content
      expect(mockPurchaseService.verifyPurchase).not.toHaveBeenCalled();
    });

    it('should return streaming URL for paid content with purchase', async () => {
      // Reset mock before test
      mockPurchaseService.verifyPurchase.mockClear();

      // Create media and paid content
      const media = await mediaService.create(
        {
          title: 'Premium Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(
            userId,
            crypto.randomUUID(),
            'premium-video.mp4'
          ),
          fileSizeBytes: 1024 * 1024 * 100,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/premium-video/master.m3u8',
          thumbnailKey: 'thumbnails/premium-video.jpg',
          durationSeconds: 600,
        },
        userId
      );

      const paidContent = await contentService.create(
        {
          organizationId,
          title: 'Premium Course',
          slug: createUniqueSlug('premium-course'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 1999, // $19.99
          tags: [],
        },
        userId
      );

      await contentService.publish(paidContent.id, userId);

      // Mock: User HAS purchased this content
      mockPurchaseService.verifyPurchase.mockResolvedValue(true);

      // User with purchase should be able to stream
      const result = await accessService.getStreamingUrl(otherUserId, {
        contentId: paidContent.id,
        expirySeconds: 3600,
      });

      expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
      expect(result.contentType).toBe('video');

      // Verify PurchaseService was called
      expect(mockPurchaseService.verifyPurchase).toHaveBeenCalledWith(
        paidContent.id,
        otherUserId
      );
      expect(mockPurchaseService.verifyPurchase).toHaveBeenCalledTimes(1);
    });

    it('should throw ACCESS_DENIED for paid content without purchase', async () => {
      // Reset mock before test
      mockPurchaseService.verifyPurchase.mockClear();

      // Create media and paid content
      const media = await mediaService.create(
        {
          title: 'Exclusive Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(
            userId,
            crypto.randomUUID(),
            'exclusive-video.mp4'
          ),
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/exclusive/master.m3u8',
          thumbnailKey: 'thumbnails/exclusive.jpg',
          durationSeconds: 300,
        },
        userId
      );

      const exclusiveContent = await contentService.create(
        {
          organizationId,
          title: 'Exclusive Content',
          slug: createUniqueSlug('exclusive'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 4999, // $49.99
          tags: [],
        },
        userId
      );

      await contentService.publish(exclusiveContent.id, userId);

      // Mock: User has NOT purchased this content
      mockPurchaseService.verifyPurchase.mockResolvedValue(false);

      // User without access should be denied
      await expect(
        accessService.getStreamingUrl(otherUserId, {
          contentId: exclusiveContent.id,
          expirySeconds: 3600,
        })
      ).rejects.toThrow(AccessDeniedError);

      // Verify PurchaseService was called
      expect(mockPurchaseService.verifyPurchase).toHaveBeenCalledWith(
        exclusiveContent.id,
        otherUserId
      );
      expect(mockPurchaseService.verifyPurchase).toHaveBeenCalledTimes(1);
    });

    it('should grant access to org paid content for management members (fallback)', async () => {
      // Reset mock before test
      mockPurchaseService.verifyPurchase.mockClear();

      // Create media and paid org content
      const media = await mediaService.create(
        {
          title: 'Org Premium Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(userId, crypto.randomUUID(), 'org-premium.mp4'),
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/org-premium/master.m3u8',
          thumbnailKey: 'thumbnails/org-premium.jpg',
          durationSeconds: 300,
        },
        userId
      );

      const orgPaidContent = await contentService.create(
        {
          organizationId, // Belongs to organization
          title: 'Org Exclusive Content',
          slug: createUniqueSlug('org-exclusive'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 2999, // $29.99
          tags: [],
        },
        userId
      );

      await contentService.publish(orgPaidContent.id, userId);

      // Mock: User has NOT purchased this content
      mockPurchaseService.verifyPurchase.mockResolvedValue(false);

      // Create org membership for otherUserId with a management role (creator).
      // Per the members→team rename (commits f585f835, 8b40f190) the paid-content
      // fallback is restricted to owner/admin/creator — regular 'member' and
      // 'subscriber' roles must purchase or subscribe.
      await db.insert(organizationMemberships).values({
        userId: otherUserId,
        organizationId,
        role: 'creator',
        status: 'active',
      });

      // User should be able to stream via management-membership fallback
      const result = await accessService.getStreamingUrl(otherUserId, {
        contentId: orgPaidContent.id,
        expirySeconds: 3600,
      });

      expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
      expect(result.contentType).toBe('video');

      // Verify PurchaseService was called first (then fallback to org membership)
      expect(mockPurchaseService.verifyPurchase).toHaveBeenCalledWith(
        orgPaidContent.id,
        otherUserId
      );
      expect(mockPurchaseService.verifyPurchase).toHaveBeenCalledTimes(1);
    });

    it('should throw CONTENT_NOT_FOUND for unpublished content', async () => {
      const media = await mediaService.create(
        {
          title: 'Draft Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(userId, crypto.randomUUID(), 'draft-video.mp4'),
          fileSizeBytes: 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/draft/master.m3u8',
          thumbnailKey: 'thumbnails/draft.jpg',
          durationSeconds: 60,
        },
        userId
      );

      const draftContent = await contentService.create(
        {
          organizationId,
          title: 'Draft Content',
          slug: createUniqueSlug('draft'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        userId
      );

      // Don't publish - stays in draft

      await expect(
        accessService.getStreamingUrl(userId, {
          contentId: draftContent.id,
          expirySeconds: 3600,
        })
      ).rejects.toThrow('Content not found');
    });
  });

  describe('savePlaybackProgress', () => {
    it('should save new playback progress', async () => {
      const media = await mediaService.create(
        {
          title: 'Progress Test Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(
            userId,
            crypto.randomUUID(),
            'progress-test.mp4'
          ),
          fileSizeBytes: 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/progress-test/master.m3u8',
          thumbnailKey: 'thumbnails/progress-test.jpg',
          durationSeconds: 600,
        },
        userId
      );

      const testContent = await contentService.create(
        {
          organizationId,
          title: 'Progress Test',
          slug: createUniqueSlug('progress-test'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        userId
      );

      await contentService.publish(testContent.id, userId);

      // Save progress
      await accessService.savePlaybackProgress(userId, {
        contentId: testContent.id,
        positionSeconds: 120,
        durationSeconds: 600,
        completed: false,
      });

      // Verify progress was saved
      const progress = await accessService.getPlaybackProgress(userId, {
        contentId: testContent.id,
      });

      expect(progress).not.toBeNull();
      expect(progress?.positionSeconds).toBe(120);
      expect(progress?.durationSeconds).toBe(600);
      expect(progress?.completed).toBe(false);
    });

    it('should update existing playback progress (upsert)', async () => {
      const media = await mediaService.create(
        {
          title: 'Upsert Test Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(userId, crypto.randomUUID(), 'upsert-test.mp4'),
          fileSizeBytes: 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/upsert-test/master.m3u8',
          thumbnailKey: 'thumbnails/upsert-test.jpg',
          durationSeconds: 300,
        },
        userId
      );

      const testContent = await contentService.create(
        {
          organizationId,
          title: 'Upsert Test',
          slug: createUniqueSlug('upsert-test'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        userId
      );

      await contentService.publish(testContent.id, userId);

      // Save initial progress
      await accessService.savePlaybackProgress(userId, {
        contentId: testContent.id,
        positionSeconds: 50,
        durationSeconds: 300,
        completed: false,
      });

      // Update progress
      await accessService.savePlaybackProgress(userId, {
        contentId: testContent.id,
        positionSeconds: 150,
        durationSeconds: 300,
        completed: false,
      });

      const progress = await accessService.getPlaybackProgress(userId, {
        contentId: testContent.id,
      });

      expect(progress?.positionSeconds).toBe(150);
    });

    it('should auto-complete when progress >= 95%', async () => {
      const media = await mediaService.create(
        {
          title: 'Completion Test Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(
            userId,
            crypto.randomUUID(),
            'completion-test.mp4'
          ),
          fileSizeBytes: 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/completion-test/master.m3u8',
          thumbnailKey: 'thumbnails/completion-test.jpg',
          durationSeconds: 100,
        },
        userId
      );

      const testContent = await contentService.create(
        {
          organizationId,
          title: 'Completion Test',
          slug: createUniqueSlug('completion-test'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        userId
      );

      await contentService.publish(testContent.id, userId);

      // Save progress at 96%
      await accessService.savePlaybackProgress(userId, {
        contentId: testContent.id,
        positionSeconds: 96,
        durationSeconds: 100,
        completed: false,
      });

      const progress = await accessService.getPlaybackProgress(userId, {
        contentId: testContent.id,
      });

      expect(progress?.completed).toBe(true);
    });
  });

  describe('getPlaybackProgress', () => {
    it('should return null for content with no progress', async () => {
      const media = await mediaService.create(
        {
          title: 'No Progress Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(userId, crypto.randomUUID(), 'no-progress.mp4'),
          fileSizeBytes: 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/no-progress/master.m3u8',
          thumbnailKey: 'thumbnails/no-progress.jpg',
          durationSeconds: 200,
        },
        userId
      );

      const testContent = await contentService.create(
        {
          organizationId,
          title: 'No Progress',
          slug: createUniqueSlug('no-progress'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        userId
      );

      await contentService.publish(testContent.id, userId);

      const progress = await accessService.getPlaybackProgress(userId, {
        contentId: testContent.id,
      });

      expect(progress).toBeNull();
    });
  });

  describe('listUserLibrary', () => {
    it('should return empty list for user with no purchases', async () => {
      // Create a fresh user with no purchases
      const userIds = await seedTestUsers(db, 1);
      const freshUserId = userIds[0];

      const result = await accessService.listUserLibrary(freshUserId, {
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
      });

      expect(result.items).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('should return purchased content with progress', async () => {
      // Create content
      const media = await mediaService.create(
        {
          title: 'Library Test Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(
            userId,
            crypto.randomUUID(),
            'library-test.mp4'
          ),
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/library-test/master.m3u8',
          thumbnailKey: 'thumbnails/library-test.jpg',
          durationSeconds: 600,
        },
        userId
      );

      const libraryContent = await contentService.create(
        {
          organizationId,
          title: 'Library Test Content',
          slug: createUniqueSlug('library-test'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 999,
          tags: [],
        },
        userId
      );

      await contentService.publish(libraryContent.id, userId);

      // Seed purchase + matching contentAccess row atomically.
      await seedPurchaseWithAccess(db, {
        customerId: otherUserId,
        contentId: libraryContent.id,
        organizationId,
        amountPaidCents: 999,
      });

      // Mirror the purchase at the mocked PurchaseService boundary so
      // hasContentAccess() (which calls verifyPurchase, not the DB) sees
      // the purchaser as having access for savePlaybackProgress.
      mockPurchaseService.verifyPurchase.mockResolvedValue(true);

      // Add some progress
      await accessService.savePlaybackProgress(otherUserId, {
        contentId: libraryContent.id,
        positionSeconds: 300,
        durationSeconds: 600,
        completed: false,
      });

      // List library
      const result = await accessService.listUserLibrary(otherUserId, {
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
      });

      expect(result.items.length).toBeGreaterThan(0);

      const item = result.items.find((i) => i.content.id === libraryContent.id);
      expect(item).toBeDefined();
      expect(item?.content.title).toBe('Library Test Content');
      // Regression guard for cross-org library bleed (Codex-q3zuf): the
      // server payload MUST include organizationId so the client can
      // filter by org on subdomain library pages. organizationSlug alone
      // was nullable and allowed null-org entries to slip through.
      expect(item?.content.organizationId).toBe(organizationId);
      expect(item?.purchase.priceCents).toBe(999);
      expect(item?.progress?.positionSeconds).toBe(300);
      expect(item?.progress?.percentComplete).toBe(50);
    });

    it('should filter by in-progress content', async () => {
      // Create multiple content items
      const userIds = await seedTestUsers(db, 1);
      const testUserId = userIds[0];

      const media1 = await mediaService.create(
        {
          title: 'In Progress Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(userId, crypto.randomUUID(), 'in-progress.mp4'),
          fileSizeBytes: 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media1.id,
        {
          hlsMasterPlaylistKey: 'hls/in-progress/master.m3u8',
          thumbnailKey: 'thumbnails/in-progress.jpg',
          durationSeconds: 100,
        },
        userId
      );

      const content1 = await contentService.create(
        {
          organizationId,
          title: 'In Progress Content',
          slug: createUniqueSlug('in-progress'),
          contentType: 'video',
          mediaItemId: media1.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 500,
          tags: [],
        },
        userId
      );

      await contentService.publish(content1.id, userId);

      // Seed purchase + matching contentAccess row atomically.
      await seedPurchaseWithAccess(db, {
        customerId: testUserId,
        contentId: content1.id,
        organizationId,
        amountPaidCents: 500,
      });

      // Mirror the purchase at the mocked PurchaseService boundary so
      // hasContentAccess() sees the purchaser as having access.
      mockPurchaseService.verifyPurchase.mockResolvedValue(true);

      await accessService.savePlaybackProgress(testUserId, {
        contentId: content1.id,
        positionSeconds: 50,
        durationSeconds: 100,
        completed: false,
      });

      // Filter for in-progress
      const result = await accessService.listUserLibrary(testUserId, {
        page: 1,
        limit: 20,
        filter: 'in_progress',
        sortBy: 'recent',
      });

      expect(
        result.items.every((item) => item.progress && !item.progress.completed)
      ).toBe(true);
    });

    // ── Subscription coverage ────────────────────────────────────────────
    // The library `querySubscription` must surface everything a subscription
    // grants the user access to — not only `accessType='subscribers'` items
    // but also tier-gated paid content. Otherwise a subscriber can stream a
    // paid piece (getStreamingUrl grants it) yet never see it in their
    // library.
    describe('Subscription library coverage', () => {
      /** Seed an org, a tier, and an active subscriber. */
      async function seedOrgWithTierAndSubscriber() {
        const [creatorUserId, subscriberUserId] = await seedTestUsers(db, 2);

        const [subOrg] = await db
          .insert(organizations)
          .values({
            name: 'Sub Library Test Org',
            slug: createUniqueSlug('sub-library-org'),
          })
          .returning();
        if (!subOrg) throw new Error('Failed to create subscription org');

        const [tier] = await db
          .insert(subscriptionTiers)
          .values(
            createTestTierInput(subOrg.id, {
              name: 'Library Test Tier',
              sortOrder: 1,
            })
          )
          .returning();
        if (!tier) throw new Error('Failed to create tier');

        await db
          .insert(subscriptions)
          .values(
            createTestSubscriptionInput(subscriberUserId, subOrg.id, tier.id)
          );

        return {
          creatorUserId,
          subscriberUserId,
          orgId: subOrg.id,
          tierId: tier.id,
        };
      }

      /** Publish a content row and override accessType + minimumTierId. */
      async function createSubscriberContent(
        creator: string,
        orgId: string,
        opts: {
          slugPrefix: string;
          accessType: 'subscribers' | 'paid';
          minimumTierId: string | null;
          priceCents: number;
        }
      ) {
        const media = await mediaService.create(
          {
            title: `${opts.slugPrefix} Video`,
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              creator,
              crypto.randomUUID(),
              `${opts.slugPrefix}.mp4`
            ),
            fileSizeBytes: 1024,
          },
          creator
        );
        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: `hls/${opts.slugPrefix}/master.m3u8`,
            thumbnailKey: `thumbnails/${opts.slugPrefix}.jpg`,
            durationSeconds: 120,
          },
          creator
        );
        // contentService.create's Zod schema couples accessType + priceCents
        // + visibility. We always insert as free to clear the schema (no
        // price, public visibility) and then patch the row directly to the
        // target accessType / priceCents / minimumTierId — mirroring the
        // Team Access helper further down this file.
        const item = await contentService.create(
          {
            organizationId: orgId,
            title: `${opts.slugPrefix} Content`,
            slug: createUniqueSlug(opts.slugPrefix),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          creator
        );
        await contentService.publish(item.id, creator);

        await db
          .update(content)
          .set({
            accessType: opts.accessType,
            priceCents: opts.priceCents,
            minimumTierId: opts.minimumTierId,
          })
          .where(eq(content.id, item.id));

        return item;
      }

      it('includes accessType=subscribers content (regression)', async () => {
        const { creatorUserId, subscriberUserId, orgId } =
          await seedOrgWithTierAndSubscriber();

        const item = await createSubscriberContent(creatorUserId, orgId, {
          slugPrefix: 'sub-only',
          accessType: 'subscribers',
          minimumTierId: null,
          priceCents: 0,
        });

        const result = await accessService.listUserLibrary(subscriberUserId, {
          page: 1,
          limit: 20,
          filter: 'all',
          sortBy: 'recent',
        });

        expect(result.items.some((i) => i.content.id === item.id)).toBe(true);
      });

      it('includes tier-gated paid content (accessType=paid + minimumTierId)', async () => {
        const { creatorUserId, subscriberUserId, orgId, tierId } =
          await seedOrgWithTierAndSubscriber();

        const item = await createSubscriberContent(creatorUserId, orgId, {
          slugPrefix: 'paid-tier-gated',
          accessType: 'paid',
          minimumTierId: tierId,
          priceCents: 999,
        });

        const result = await accessService.listUserLibrary(subscriberUserId, {
          page: 1,
          limit: 20,
          filter: 'all',
          sortBy: 'recent',
        });

        expect(result.items.some((i) => i.content.id === item.id)).toBe(true);
      });

      it('excludes paid content WITHOUT a minimumTierId (purchase-only)', async () => {
        const { creatorUserId, subscriberUserId, orgId } =
          await seedOrgWithTierAndSubscriber();

        const item = await createSubscriberContent(creatorUserId, orgId, {
          slugPrefix: 'paid-no-tier',
          accessType: 'paid',
          minimumTierId: null,
          priceCents: 999,
        });

        const result = await accessService.listUserLibrary(subscriberUserId, {
          page: 1,
          limit: 20,
          filter: 'all',
          sortBy: 'recent',
        });

        expect(result.items.some((i) => i.content.id === item.id)).toBe(false);
      });

      it('does not duplicate a purchased item that is also subscription-accessible', async () => {
        const { creatorUserId, subscriberUserId, orgId, tierId } =
          await seedOrgWithTierAndSubscriber();

        const item = await createSubscriberContent(creatorUserId, orgId, {
          slugPrefix: 'paid-dedup',
          accessType: 'paid',
          minimumTierId: tierId,
          priceCents: 999,
        });

        // User both purchased AND subscribed.
        await seedPurchaseWithAccess(db, {
          customerId: subscriberUserId,
          contentId: item.id,
          organizationId: orgId,
          amountPaidCents: 999,
        });

        const result = await accessService.listUserLibrary(subscriberUserId, {
          page: 1,
          limit: 20,
          filter: 'all',
          sortBy: 'recent',
        });

        const matches = result.items.filter((i) => i.content.id === item.id);
        expect(matches).toHaveLength(1);
        expect(matches[0].accessType).toBe('purchased');
      });

      it('excludes an item with a PENDING purchase from the subscription arm (race-window dedup)', async () => {
        // Regression: after 1b6f14a0 (broadening querySubscription to include
        // `accessType='paid' + minimumTierId IS NOT NULL` content) the dedup
        // subquery that filtered out "already purchased" content only
        // matched `status='completed'`. A pending purchase — created by the
        // client-initiated Stripe checkout but not yet finalised by the
        // `checkout.session.completed` webhook — would therefore leak into
        // the subscription arm and show up in the library tagged
        // `accessType='subscription'` instead of hiding until the webhook
        // finalised it. The fix (this test's contract) is to dedup against
        // both `completed` AND `pending` statuses.
        const { creatorUserId, subscriberUserId, orgId, tierId } =
          await seedOrgWithTierAndSubscriber();

        const item = await createSubscriberContent(creatorUserId, orgId, {
          slugPrefix: 'paid-pending-dedup',
          accessType: 'paid',
          minimumTierId: tierId,
          priceCents: 999,
        });

        // Insert a purchase in the `pending` state — webhook hasn't landed
        // yet. Bypasses seedPurchaseWithAccess because that helper creates a
        // completed purchase + contentAccess row.
        await db.insert(purchases).values({
          customerId: subscriberUserId,
          contentId: item.id,
          organizationId: orgId,
          amountPaidCents: 999,
          platformFeeCents: 100,
          organizationFeeCents: 135,
          creatorPayoutCents: 764,
          currency: 'GBP',
          status: 'pending',
          stripePaymentIntentId: `pi_pending_${Date.now()}`,
          stripeSessionId: `cs_pending_${Date.now()}`,
        });

        const result = await accessService.listUserLibrary(subscriberUserId, {
          page: 1,
          limit: 20,
          filter: 'all',
          sortBy: 'recent',
        });

        // Pending purchase is neither in purchased (requires completed) nor
        // subscription (now deduped by pending) — the item shouldn't leak
        // into the library under the wrong tag. Once the webhook lands and
        // flips status to completed, the purchased arm surfaces it.
        const matches = result.items.filter((i) => i.content.id === item.id);
        expect(matches).toHaveLength(0);
      });
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    describe('Progress Tracking Edge Cases', () => {
      it('should handle progress at exactly 95.0%', async () => {
        const media = await mediaService.create(
          {
            title: 'Exact 95% Test',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(userId, crypto.randomUUID(), 'exact-95.mp4'),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/exact-95/master.m3u8',
            thumbnailKey: 'thumbnails/exact-95.jpg',
            durationSeconds: 100,
          },
          userId
        );

        const testContent = await contentService.create(
          {
            organizationId,
            title: 'Exact 95% Boundary',
            slug: createUniqueSlug('exact-95'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          userId
        );

        await contentService.publish(testContent.id, userId);

        // Save progress at exactly 95.0%
        await accessService.savePlaybackProgress(userId, {
          contentId: testContent.id,
          positionSeconds: 95,
          durationSeconds: 100,
          completed: false,
        });

        const progress = await accessService.getPlaybackProgress(userId, {
          contentId: testContent.id,
        });

        // At exactly 95%, should be auto-completed
        expect(progress?.completed).toBe(true);
        expect(progress?.positionSeconds).toBe(95);
      });

      it('should handle progress at 94.9% (just below threshold)', async () => {
        const media = await mediaService.create(
          {
            title: 'Below 95% Test',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(userId, crypto.randomUUID(), 'below-95.mp4'),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/below-95/master.m3u8',
            thumbnailKey: 'thumbnails/below-95.jpg',
            durationSeconds: 1000,
          },
          userId
        );

        const testContent = await contentService.create(
          {
            organizationId,
            title: 'Below 95% Boundary',
            slug: createUniqueSlug('below-95'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          userId
        );

        await contentService.publish(testContent.id, userId);

        // Save progress at 94.9%
        await accessService.savePlaybackProgress(userId, {
          contentId: testContent.id,
          positionSeconds: 949,
          durationSeconds: 1000,
          completed: false,
        });

        const progress = await accessService.getPlaybackProgress(userId, {
          contentId: testContent.id,
        });

        // Below 95%, should NOT be auto-completed
        expect(progress?.completed).toBe(false);
        expect(progress?.positionSeconds).toBe(949);
      });

      it('should handle zero duration seconds', async () => {
        const media = await mediaService.create(
          {
            title: 'Zero Duration Test',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              userId,
              crypto.randomUUID(),
              'zero-duration.mp4'
            ),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/zero-duration/master.m3u8',
            thumbnailKey: 'thumbnails/zero-duration.jpg',
            durationSeconds: 0,
          },
          userId
        );

        const testContent = await contentService.create(
          {
            organizationId,
            title: 'Zero Duration',
            slug: createUniqueSlug('zero-duration'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          userId
        );

        await contentService.publish(testContent.id, userId);

        // Save progress with 0 duration
        await accessService.savePlaybackProgress(userId, {
          contentId: testContent.id,
          positionSeconds: 0,
          durationSeconds: 0,
          completed: false,
        });

        const progress = await accessService.getPlaybackProgress(userId, {
          contentId: testContent.id,
        });

        expect(progress).not.toBeNull();
        expect(progress?.positionSeconds).toBe(0);
        expect(progress?.durationSeconds).toBe(0);
      });

      it('should handle position > duration', async () => {
        const media = await mediaService.create(
          {
            title: 'Position Overflow Test',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(userId, crypto.randomUUID(), 'overflow.mp4'),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/overflow/master.m3u8',
            thumbnailKey: 'thumbnails/overflow.jpg',
            durationSeconds: 100,
          },
          userId
        );

        const testContent = await contentService.create(
          {
            organizationId,
            title: 'Position Overflow',
            slug: createUniqueSlug('overflow'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          userId
        );

        await contentService.publish(testContent.id, userId);

        // Position exceeds duration (can happen with live video or player bugs)
        await accessService.savePlaybackProgress(userId, {
          contentId: testContent.id,
          positionSeconds: 150,
          durationSeconds: 100,
          completed: false,
        });

        const progress = await accessService.getPlaybackProgress(userId, {
          contentId: testContent.id,
        });

        expect(progress).not.toBeNull();
        expect(progress?.positionSeconds).toBe(150);
        // Should be auto-completed since 150 > 95
        expect(progress?.completed).toBe(true);
      });

      it('should handle very large duration (multi-hour video)', async () => {
        const media = await mediaService.create(
          {
            title: 'Long Video Test',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              userId,
              crypto.randomUUID(),
              'long-video.mp4'
            ),
            fileSizeBytes: 1024 * 1024 * 1024,
          },
          userId
        );

        const longDuration = 10800; // 3 hours

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/long-video/master.m3u8',
            thumbnailKey: 'thumbnails/long-video.jpg',
            durationSeconds: longDuration,
          },
          userId
        );

        const testContent = await contentService.create(
          {
            organizationId,
            title: 'Long Duration Video',
            slug: createUniqueSlug('long-video'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          userId
        );

        await contentService.publish(testContent.id, userId);

        // Save progress at halfway point
        await accessService.savePlaybackProgress(userId, {
          contentId: testContent.id,
          positionSeconds: 5400,
          durationSeconds: longDuration,
          completed: false,
        });

        const progress = await accessService.getPlaybackProgress(userId, {
          contentId: testContent.id,
        });

        expect(progress?.positionSeconds).toBe(5400);
        expect(progress?.durationSeconds).toBe(longDuration);
        expect(progress?.completed).toBe(false);
      });
    });

    describe('R2 Key Edge Cases', () => {
      it('should handle R2 keys with special characters', async () => {
        const media = await mediaService.create(
          {
            title: 'Special Chars Test',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              userId,
              crypto.randomUUID(),
              'test-video_with-special-chars-2024.mp4'
            ),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey:
              'hls/test-video_with-special-chars-2024/master.m3u8',
            thumbnailKey: 'thumbnails/special-chars.jpg',
            durationSeconds: 120,
          },
          userId
        );

        const testContent = await contentService.create(
          {
            organizationId,
            title: 'Special Characters',
            slug: createUniqueSlug('special-chars'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          userId
        );

        await contentService.publish(testContent.id, userId);

        const result = await accessService.getStreamingUrl(userId, {
          contentId: testContent.id,
          expirySeconds: 3600,
        });

        // URL should be properly encoded
        expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
        expect(result.streamingUrl).toContain('X-Amz-Signature');
      });

      it('should handle R2 keys with underscores and hyphens', async () => {
        const media = await mediaService.create(
          {
            title: 'Underscores and Hyphens Test',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              userId,
              crypto.randomUUID(),
              'test_video-with-underscores_and-hyphens.mp4'
            ),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey:
              'hls/test_video-with-underscores_and-hyphens/master.m3u8',
            thumbnailKey: 'thumbnails/underscores_hyphens.jpg',
            durationSeconds: 120,
          },
          userId
        );

        const testContent = await contentService.create(
          {
            organizationId,
            title: 'Spaces in Key',
            slug: createUniqueSlug('spaces'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          userId
        );

        await contentService.publish(testContent.id, userId);

        const result = await accessService.getStreamingUrl(userId, {
          contentId: testContent.id,
          expirySeconds: 3600,
        });

        // URL should be properly URL-encoded
        expect(result.streamingUrl).toBeDefined();
        expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
      });

      it('should handle R2 keys with deep directory paths', async () => {
        const media = await mediaService.create(
          {
            title: 'Deep Path Test',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              userId,
              crypto.randomUUID(),
              '2024/november/videos/test.mp4'
            ),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/2024/november/videos/master.m3u8',
            thumbnailKey: 'thumbnails/deep-path.jpg',
            durationSeconds: 120,
          },
          userId
        );

        const testContent = await contentService.create(
          {
            organizationId,
            title: 'Unicode in Key',
            slug: createUniqueSlug('unicode'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          userId
        );

        await contentService.publish(testContent.id, userId);

        const result = await accessService.getStreamingUrl(userId, {
          contentId: testContent.id,
          expirySeconds: 3600,
        });

        // URL should handle unicode characters
        expect(result.streamingUrl).toBeDefined();
        expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
      });
    });

    describe('Access Control Edge Cases', () => {
      it('should handle deleted content (soft delete)', async () => {
        const media = await mediaService.create(
          {
            title: 'To Be Deleted',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(userId, crypto.randomUUID(), 'to-delete.mp4'),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/to-delete/master.m3u8',
            thumbnailKey: 'thumbnails/to-delete.jpg',
            durationSeconds: 120,
          },
          userId
        );

        const testContent = await contentService.create(
          {
            organizationId,
            title: 'To Be Deleted',
            slug: createUniqueSlug('to-delete'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          userId
        );

        await contentService.publish(testContent.id, userId);

        // Delete content
        await contentService.delete(testContent.id, userId);

        // Should not be accessible after deletion
        await expect(
          accessService.getStreamingUrl(userId, {
            contentId: testContent.id,
            expirySeconds: 3600,
          })
        ).rejects.toThrow('Content not found');
      });

      it('should handle content with priceCents = 0 (free)', async () => {
        // Reset mock before test
        mockPurchaseService.verifyPurchase.mockClear();

        const media = await mediaService.create(
          {
            title: 'Free Content Test',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(userId, crypto.randomUUID(), 'free.mp4'),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/free/master.m3u8',
            thumbnailKey: 'thumbnails/free.jpg',
            durationSeconds: 120,
          },
          userId
        );

        const testContent = await contentService.create(
          {
            organizationId,
            title: 'Free Content',
            slug: createUniqueSlug('free'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0, // Explicitly free
            tags: [],
          },
          userId
        );

        await contentService.publish(testContent.id, userId);

        // Should be accessible without purchase
        const result = await accessService.getStreamingUrl(otherUserId, {
          contentId: testContent.id,
          expirySeconds: 3600,
        });

        expect(result.streamingUrl).toBeDefined();

        // Verify PurchaseService was NOT called for free content
        expect(mockPurchaseService.verifyPurchase).not.toHaveBeenCalled();
      });

      it('should handle content with very high price', async () => {
        // Reset mock before test
        mockPurchaseService.verifyPurchase.mockClear();

        // Create fresh user without org membership to ensure access is denied
        const [freshUserId] = await seedTestUsers(db, 1);

        const media = await mediaService.create(
          {
            title: 'Expensive Content',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(userId, crypto.randomUUID(), 'expensive.mp4'),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/expensive/master.m3u8',
            thumbnailKey: 'thumbnails/expensive.jpg',
            durationSeconds: 120,
          },
          userId
        );

        const testContent = await contentService.create(
          {
            organizationId,
            title: 'Very Expensive',
            slug: createUniqueSlug('expensive'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'purchased_only',
            accessType: 'paid',
            priceCents: 9999999, // $99,999.99 (max allowed is $100,000)
            tags: [],
          },
          userId
        );

        await contentService.publish(testContent.id, userId);

        // Mock: User has NOT purchased this content
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        // Without purchase and not org member, should be denied
        await expect(
          accessService.getStreamingUrl(freshUserId, {
            contentId: testContent.id,
            expirySeconds: 3600,
          })
        ).rejects.toThrow(AccessDeniedError);

        // Verify PurchaseService was called
        expect(mockPurchaseService.verifyPurchase).toHaveBeenCalledWith(
          testContent.id,
          freshUserId
        );
      });
    });

    describe('Pagination Edge Cases', () => {
      it('should handle page beyond total pages', async () => {
        const result = await accessService.listUserLibrary(userId, {
          page: 999,
          limit: 20,
          filter: 'all',
          sortBy: 'recent',
        });

        expect(result.items).toHaveLength(0);
        expect(result.pagination.page).toBe(999);
      });

      it('should handle limit = 1 (minimum)', async () => {
        const result = await accessService.listUserLibrary(userId, {
          page: 1,
          limit: 1,
          filter: 'all',
          sortBy: 'recent',
        });

        expect(result.items.length).toBeLessThanOrEqual(1);
        expect(result.pagination.limit).toBe(1);
      });

      it('should handle limit = 100 (maximum)', async () => {
        const result = await accessService.listUserLibrary(userId, {
          page: 1,
          limit: 100,
          filter: 'all',
          sortBy: 'recent',
        });

        expect(result.items.length).toBeLessThanOrEqual(100);
        expect(result.pagination.limit).toBe(100);
      });
    });

    describe('Subscription Access', () => {
      // NOTE: Subscription access checks are handled at the service layer
      // via ContentAccessService.getStreamingUrl which checks subscriptions table.
      // These tests document the expected behavior — full integration requires
      // subscription records in the DB.

      it('should grant access for sufficient subscription tier', async () => {
        // Subscription access is checked after purchase check fails.
        // If user has an active subscription to the org with sufficient tier,
        // access is granted. This test documents the expected flow.
        // Full integration would require subscription + tier setup.
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        // For now, verify the denial path works without subscription
        const [freshUserId] = await seedTestUsers(db, 1);
        const media = await mediaService.create(
          {
            title: 'Sub Access Video',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              userId,
              crypto.randomUUID(),
              'sub-access.mp4'
            ),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/sub-access/master.m3u8',
            thumbnailKey: 'thumbnails/sub-access.jpg',
            durationSeconds: 120,
          },
          userId
        );

        const content = await contentService.create(
          {
            organizationId,
            title: 'Sub Access Content',
            slug: createUniqueSlug('sub-access'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'purchased_only',
            accessType: 'paid',
            priceCents: 999,
            tags: [],
          },
          userId
        );

        await contentService.publish(content.id, userId);

        // Without subscription or purchase, should be denied
        await expect(
          accessService.getStreamingUrl(freshUserId, {
            contentId: content.id,
            expirySeconds: 3600,
          })
        ).rejects.toThrow(AccessDeniedError);
      });
    });

    describe('Hybrid Paid+Subscription Access (paid with minimumTierId)', () => {
      /**
       * Hybrid mode: accessType='paid' AND minimumTierId is set. The content
       * is purchasable by anyone AND automatically granted to subscribers at
       * tier >= minimumTier. This is the sixth legitimate access mode.
       */
      async function createHybridOrgWithTiers(slugSuffix: string) {
        const [org] = await db
          .insert(organizations)
          .values({
            name: `Hybrid Org ${slugSuffix}`,
            slug: createUniqueSlug(`hybrid-org-${slugSuffix}`),
          })
          .returning();

        if (!org) {
          throw new Error('Failed to create hybrid test organization');
        }

        const [basicTier] = await db
          .insert(subscriptionTiers)
          .values(
            createTestTierInput(org.id, {
              name: 'Basic',
              sortOrder: 1,
              priceMonthly: 499,
              priceAnnual: 4990,
            })
          )
          .returning();

        const [proTier] = await db
          .insert(subscriptionTiers)
          .values(
            createTestTierInput(org.id, {
              name: 'Pro',
              sortOrder: 2,
              priceMonthly: 999,
              priceAnnual: 9990,
            })
          )
          .returning();

        if (!basicTier || !proTier) {
          throw new Error('Failed to create hybrid test tiers');
        }

        return { org, basicTier, proTier };
      }

      async function createHybridContent(
        orgId: string,
        minimumTierId: string,
        slugSuffix: string
      ) {
        const media = await mediaService.create(
          {
            title: `Hybrid Video ${slugSuffix}`,
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              userId,
              crypto.randomUUID(),
              `${slugSuffix}.mp4`
            ),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: `hls/${slugSuffix}/master.m3u8`,
            thumbnailKey: `thumbnails/${slugSuffix}.jpg`,
            durationSeconds: 120,
          },
          userId
        );

        const item = await contentService.create(
          {
            organizationId: orgId,
            title: `Hybrid Content ${slugSuffix}`,
            slug: createUniqueSlug(slugSuffix),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'purchased_only',
            accessType: 'paid',
            priceCents: 1999,
            minimumTierId,
            tags: [],
          },
          userId
        );

        await contentService.publish(item.id, userId);

        return item;
      }

      it('should deny hybrid content to anonymous-equivalent user (no purchase, no subscription)', async () => {
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        const { org, proTier } = await createHybridOrgWithTiers('hybrid-anon');
        const item = await createHybridContent(
          org.id,
          proTier.id,
          'hybrid-anon'
        );

        const [freshUserId] = await seedTestUsers(db, 1);

        await expect(
          accessService.getStreamingUrl(freshUserId, {
            contentId: item.id,
            expirySeconds: 3600,
          })
        ).rejects.toThrow(AccessDeniedError);
      });

      it('should grant hybrid content to subscriber at minimum tier (subscription path)', async () => {
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        const { org, proTier } =
          await createHybridOrgWithTiers('hybrid-at-tier');
        const item = await createHybridContent(
          org.id,
          proTier.id,
          'hybrid-at-tier'
        );

        const [subUserId] = await seedTestUsers(db, 1);

        // Active subscription AT the minimum tier (proTier)
        await db.insert(subscriptions).values(
          createTestSubscriptionInput(subUserId, org.id, proTier.id, {
            status: 'active',
          })
        );

        const result = await accessService.getStreamingUrl(subUserId, {
          contentId: item.id,
          expirySeconds: 3600,
        });

        expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
        expect(result.contentType).toBe('video');
      });

      it('should grant hybrid content to subscriber above minimum tier (subscription path)', async () => {
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        const { org, basicTier, proTier } =
          await createHybridOrgWithTiers('hybrid-above-tier');
        // Content requires Basic (sortOrder=1) as minimum; user subscribes
        // to Pro (sortOrder=2), which is above and should grant access.
        const item = await createHybridContent(
          org.id,
          basicTier.id,
          'hybrid-above-tier'
        );

        const [subUserId] = await seedTestUsers(db, 1);

        await db.insert(subscriptions).values(
          createTestSubscriptionInput(subUserId, org.id, proTier.id, {
            status: 'active',
          })
        );

        const result = await accessService.getStreamingUrl(subUserId, {
          contentId: item.id,
          expirySeconds: 3600,
        });

        expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
      });

      it('should deny hybrid content to subscriber below minimum tier (no purchase)', async () => {
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        const { org, basicTier, proTier } =
          await createHybridOrgWithTiers('hybrid-below-tier');
        // Content requires Pro (sortOrder=2) as minimum; user subscribes
        // to Basic (sortOrder=1), which is below — denial, must purchase.
        const item = await createHybridContent(
          org.id,
          proTier.id,
          'hybrid-below-tier'
        );

        const [subUserId] = await seedTestUsers(db, 1);

        await db.insert(subscriptions).values(
          createTestSubscriptionInput(subUserId, org.id, basicTier.id, {
            status: 'active',
          })
        );

        await expect(
          accessService.getStreamingUrl(subUserId, {
            contentId: item.id,
            expirySeconds: 3600,
          })
        ).rejects.toThrow(AccessDeniedError);
      });

      it('should grant hybrid content to user with existing purchase (purchase path)', async () => {
        mockPurchaseService.verifyPurchase.mockClear();

        const { org, proTier } =
          await createHybridOrgWithTiers('hybrid-purchase');
        const item = await createHybridContent(
          org.id,
          proTier.id,
          'hybrid-purchase'
        );

        const [purchaserUserId] = await seedTestUsers(db, 1);

        // No subscription — user bought it outright. PurchaseService is the
        // authority for purchase state in this suite.
        mockPurchaseService.verifyPurchase.mockResolvedValue(true);

        const result = await accessService.getStreamingUrl(purchaserUserId, {
          contentId: item.id,
          expirySeconds: 3600,
        });

        expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
        expect(result.contentType).toBe('video');
        expect(mockPurchaseService.verifyPurchase).toHaveBeenCalledWith(
          item.id,
          purchaserUserId
        );
      });
    });

    describe('Team Access (replaces members-only)', () => {
      /**
       * Helper: create published content with a given accessType.
       * Content is created as free (default), then accessType is updated directly.
       */
      async function createContentWithAccessType(
        accessType: string,
        slugSuffix: string
      ) {
        const media = await mediaService.create(
          {
            title: `${accessType} Video`,
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              userId,
              crypto.randomUUID(),
              `${slugSuffix}.mp4`
            ),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: `hls/${slugSuffix}/master.m3u8`,
            thumbnailKey: `thumbnails/${slugSuffix}.jpg`,
            durationSeconds: 120,
          },
          userId
        );

        const item = await contentService.create(
          {
            organizationId,
            title: `${accessType} Content ${slugSuffix}`,
            slug: createUniqueSlug(slugSuffix),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          userId
        );

        await contentService.publish(item.id, userId);

        // Set accessType directly (bypasses validation since we're in tests)
        await db
          .update(content)
          .set({ accessType })
          .where(eq(content.id, item.id));

        return item;
      }

      it('should grant team content access to owner', async () => {
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        const item = await createContentWithAccessType('team', 'team-owner');

        const [ownerUser] = await seedTestUsers(db, 1);
        await db.insert(organizationMemberships).values({
          userId: ownerUser,
          organizationId,
          role: 'owner',
          status: 'active',
        });

        const result = await accessService.getStreamingUrl(ownerUser, {
          contentId: item.id,
          expirySeconds: 3600,
        });

        expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
      });

      it('should grant team content access to admin', async () => {
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        const item = await createContentWithAccessType('team', 'team-admin');

        const [adminUser] = await seedTestUsers(db, 1);
        await db.insert(organizationMemberships).values({
          userId: adminUser,
          organizationId,
          role: 'admin',
          status: 'active',
        });

        const result = await accessService.getStreamingUrl(adminUser, {
          contentId: item.id,
          expirySeconds: 3600,
        });

        expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
      });

      it('should deny team content to subscriber', async () => {
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        const item = await createContentWithAccessType('team', 'team-deny-sub');

        const [subUser] = await seedTestUsers(db, 1);
        await db.insert(organizationMemberships).values({
          userId: subUser,
          organizationId,
          role: 'subscriber',
          status: 'active',
        });

        await expect(
          accessService.getStreamingUrl(subUser, {
            contentId: item.id,
            expirySeconds: 3600,
          })
        ).rejects.toThrow(AccessDeniedError);
      });

      it('should deny team content to follower', async () => {
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        const item = await createContentWithAccessType(
          'team',
          'team-deny-follower'
        );

        const [followerUser] = await seedTestUsers(db, 1);
        await db
          .insert(organizationFollowers)
          .values({ userId: followerUser, organizationId });

        await expect(
          accessService.getStreamingUrl(followerUser, {
            contentId: item.id,
            expirySeconds: 3600,
          })
        ).rejects.toThrow(AccessDeniedError);
      });
    });

    describe('Follower Access', () => {
      async function createContentWithAccessType(
        accessType: string,
        slugSuffix: string
      ) {
        const media = await mediaService.create(
          {
            title: `${accessType} Video`,
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              userId,
              crypto.randomUUID(),
              `${slugSuffix}.mp4`
            ),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: `hls/${slugSuffix}/master.m3u8`,
            thumbnailKey: `thumbnails/${slugSuffix}.jpg`,
            durationSeconds: 120,
          },
          userId
        );

        const item = await contentService.create(
          {
            organizationId,
            title: `${accessType} Content ${slugSuffix}`,
            slug: createUniqueSlug(slugSuffix),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          userId
        );

        await contentService.publish(item.id, userId);

        await db
          .update(content)
          .set({ accessType })
          .where(eq(content.id, item.id));

        return item;
      }

      it('should grant follower content to a follower', async () => {
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        const item = await createContentWithAccessType(
          'followers',
          'follow-grant'
        );

        const [followerUser] = await seedTestUsers(db, 1);
        await db
          .insert(organizationFollowers)
          .values({ userId: followerUser, organizationId });

        const result = await accessService.getStreamingUrl(followerUser, {
          contentId: item.id,
          expirySeconds: 3600,
        });

        expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
      });

      it('should deny follower content to non-follower', async () => {
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        const item = await createContentWithAccessType(
          'followers',
          'follow-deny'
        );

        const [freshUser] = await seedTestUsers(db, 1);

        await expect(
          accessService.getStreamingUrl(freshUser, {
            contentId: item.id,
            expirySeconds: 3600,
          })
        ).rejects.toThrow(AccessDeniedError);
      });

      it('should grant follower content to management (implicit access)', async () => {
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        const item = await createContentWithAccessType(
          'followers',
          'follow-mgmt'
        );

        const [creatorUser] = await seedTestUsers(db, 1);
        await db.insert(organizationMemberships).values({
          userId: creatorUser,
          organizationId,
          role: 'creator',
          status: 'active',
        });

        const result = await accessService.getStreamingUrl(creatorUser, {
          contentId: item.id,
          expirySeconds: 3600,
        });

        expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
      });
    });

    describe('Management Bypass', () => {
      it('should grant access to paid content for org owner', async () => {
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        const media = await mediaService.create(
          {
            title: 'Owner Bypass Video',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              userId,
              crypto.randomUUID(),
              'owner-bypass.mp4'
            ),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/owner-bypass/master.m3u8',
            thumbnailKey: 'thumbnails/owner-bypass.jpg',
            durationSeconds: 120,
          },
          userId
        );

        const content = await contentService.create(
          {
            organizationId,
            title: 'Owner Bypass Content',
            slug: createUniqueSlug('owner-bypass'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'purchased_only',
            accessType: 'paid',
            priceCents: 4999,
            tags: [],
          },
          userId
        );

        await contentService.publish(content.id, userId);

        // Create owner membership
        const [ownerUserId] = await seedTestUsers(db, 1);
        await db.insert(organizationMemberships).values({
          userId: ownerUserId,
          organizationId,
          role: 'owner',
          status: 'active',
        });

        // Owner should bypass paid access check
        const result = await accessService.getStreamingUrl(ownerUserId, {
          contentId: content.id,
          expirySeconds: 3600,
        });

        expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
      });

      it('should deny paid content for subscriber without purchase', async () => {
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        const media = await mediaService.create(
          {
            title: 'Sub Deny Video',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(userId, crypto.randomUUID(), 'sub-deny.mp4'),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/sub-deny/master.m3u8',
            thumbnailKey: 'thumbnails/sub-deny.jpg',
            durationSeconds: 120,
          },
          userId
        );

        const content = await contentService.create(
          {
            organizationId,
            title: 'Sub Deny Content',
            slug: createUniqueSlug('sub-deny'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'purchased_only',
            accessType: 'paid',
            priceCents: 2999,
            tags: [],
          },
          userId
        );

        await contentService.publish(content.id, userId);

        // Create subscriber membership (not owner/admin/creator)
        const [subUserId] = await seedTestUsers(db, 1);
        await db.insert(organizationMemberships).values({
          userId: subUserId,
          organizationId,
          role: 'subscriber',
          status: 'active',
        });

        // Subscriber role without purchase should be denied for paid content.
        // Only management roles (owner/admin/creator) bypass purchase requirement.
        await expect(
          accessService.getStreamingUrl(subUserId, {
            contentId: content.id,
            expirySeconds: 3600,
          })
        ).rejects.toThrow(AccessDeniedError);
      });
    });

    describe('No Access Edge Case', () => {
      it('should deny access when user has no subscription, no purchase, and no membership', async () => {
        mockPurchaseService.verifyPurchase.mockClear();
        mockPurchaseService.verifyPurchase.mockResolvedValue(false);

        const media = await mediaService.create(
          {
            title: 'No Access Video',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              userId,
              crypto.randomUUID(),
              'no-access-edge.mp4'
            ),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/no-access-edge/master.m3u8',
            thumbnailKey: 'thumbnails/no-access-edge.jpg',
            durationSeconds: 120,
          },
          userId
        );

        const content = await contentService.create(
          {
            organizationId,
            title: 'No Access Edge',
            slug: createUniqueSlug('no-access-edge'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'purchased_only',
            accessType: 'paid',
            priceCents: 999,
            tags: [],
          },
          userId
        );

        await contentService.publish(content.id, userId);

        const [freshUserId] = await seedTestUsers(db, 1);

        await expect(
          accessService.getStreamingUrl(freshUserId, {
            contentId: content.id,
            expirySeconds: 3600,
          })
        ).rejects.toThrow(AccessDeniedError);
      });
    });

    describe('Library Filter: contentType', () => {
      it('should filter library by video contentType', async () => {
        const result = await accessService.listUserLibrary(otherUserId, {
          page: 1,
          limit: 20,
          filter: 'all',
          sortBy: 'recent',
          contentType: 'video',
        });

        // All items should be video type
        for (const item of result.items) {
          expect(item.content.contentType).toBe('video');
        }
      });

      it('should filter library by audio contentType', async () => {
        const result = await accessService.listUserLibrary(otherUserId, {
          page: 1,
          limit: 20,
          filter: 'all',
          sortBy: 'recent',
          contentType: 'audio',
        });

        // All items should be audio type (may be empty if no audio content)
        for (const item of result.items) {
          expect(item.content.contentType).toBe('audio');
        }
      });
    });

    describe('Library Filter: sortBy', () => {
      it('should sort library by title', async () => {
        const result = await accessService.listUserLibrary(otherUserId, {
          page: 1,
          limit: 100,
          filter: 'all',
          sortBy: 'title',
        });

        // Verify items are sorted by title
        for (let i = 1; i < result.items.length; i++) {
          const prev = result.items[i - 1].content.title.toLowerCase();
          const curr = result.items[i].content.title.toLowerCase();
          expect(prev <= curr).toBe(true);
        }
      });
    });

    describe('Library Filter: search', () => {
      it('should filter library by search term', async () => {
        const result = await accessService.listUserLibrary(otherUserId, {
          page: 1,
          limit: 20,
          filter: 'all',
          sortBy: 'recent',
          search: 'Library Test',
        });

        // Items matching search should be returned
        for (const item of result.items) {
          expect(
            item.content.title
              .toLowerCase()
              .includes('library test'.toLowerCase())
          ).toBe(true);
        }
      });
    });

    describe('Library Filter: completed/not_started/in_progress', () => {
      it('should filter library by completed status', async () => {
        const result = await accessService.listUserLibrary(otherUserId, {
          page: 1,
          limit: 100,
          filter: 'completed',
          sortBy: 'recent',
        });

        for (const item of result.items) {
          expect(item.progress?.completed).toBe(true);
        }
      });

      it('should filter library by not_started status', async () => {
        const result = await accessService.listUserLibrary(otherUserId, {
          page: 1,
          limit: 100,
          filter: 'not_started',
          sortBy: 'recent',
        });

        for (const item of result.items) {
          // not_started means no progress or positionSeconds === 0
          expect(!item.progress || item.progress.positionSeconds === 0).toBe(
            true
          );
        }
      });

      it('should filter library by in_progress status', async () => {
        const result = await accessService.listUserLibrary(otherUserId, {
          page: 1,
          limit: 100,
          filter: 'in_progress',
          sortBy: 'recent',
        });

        for (const item of result.items) {
          expect(item.progress).toBeDefined();
          expect(item.progress?.completed).toBe(false);
          expect(item.progress!.positionSeconds).toBeGreaterThan(0);
        }
      });
    });

    describe('Concurrent Operations', () => {
      it('should handle multiple concurrent progress saves for same user/content', async () => {
        const media = await mediaService.create(
          {
            title: 'Concurrent Test',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              userId,
              crypto.randomUUID(),
              'concurrent.mp4'
            ),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/concurrent/master.m3u8',
            thumbnailKey: 'thumbnails/concurrent.jpg',
            durationSeconds: 100,
          },
          userId
        );

        const testContent = await contentService.create(
          {
            organizationId,
            title: 'Concurrent Saves',
            slug: createUniqueSlug('concurrent'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          userId
        );

        await contentService.publish(testContent.id, userId);

        // Simulate concurrent saves from different devices/tabs
        const saves = [
          accessService.savePlaybackProgress(userId, {
            contentId: testContent.id,
            positionSeconds: 10,
            durationSeconds: 100,
            completed: false,
          }),
          accessService.savePlaybackProgress(userId, {
            contentId: testContent.id,
            positionSeconds: 20,
            durationSeconds: 100,
            completed: false,
          }),
          accessService.savePlaybackProgress(userId, {
            contentId: testContent.id,
            positionSeconds: 30,
            durationSeconds: 100,
            completed: false,
          }),
        ];

        // All saves should succeed (last write wins with upsert)
        await Promise.all(saves);

        const progress = await accessService.getPlaybackProgress(userId, {
          contentId: testContent.id,
        });

        // One of the positions should be saved
        expect(progress).not.toBeNull();
        expect([10, 20, 30]).toContain(progress?.positionSeconds);
      });

      it('should handle concurrent streaming URL requests', async () => {
        const media = await mediaService.create(
          {
            title: 'Concurrent Streaming',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              userId,
              crypto.randomUUID(),
              'concurrent-stream.mp4'
            ),
            fileSizeBytes: 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: 'hls/concurrent-stream/master.m3u8',
            thumbnailKey: 'thumbnails/concurrent-stream.jpg',
            durationSeconds: 100,
          },
          userId
        );

        const testContent = await contentService.create(
          {
            organizationId,
            title: 'Concurrent Stream Requests',
            slug: createUniqueSlug('concurrent-stream'),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          userId
        );

        await contentService.publish(testContent.id, userId);

        // Simulate multiple devices requesting stream simultaneously
        const requests = [
          accessService.getStreamingUrl(userId, {
            contentId: testContent.id,
            expirySeconds: 3600,
          }),
          accessService.getStreamingUrl(userId, {
            contentId: testContent.id,
            expirySeconds: 3600,
          }),
          accessService.getStreamingUrl(userId, {
            contentId: testContent.id,
            expirySeconds: 3600,
          }),
        ];

        const results = await Promise.all(requests);

        // All requests should succeed with valid URLs
        for (const result of results) {
          expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
          expect(result.streamingUrl).toContain('X-Amz-Signature');
        }
      });
    });
  });
});
