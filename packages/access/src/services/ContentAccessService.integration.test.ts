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
import { contentAccess, purchases } from '@codex/database/schema';
import { ObservabilityClient } from '@codex/observability';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
  withNeonTestBranch,
} from '@codex/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentAccessService } from './ContentAccessService';

// Enable ephemeral Neon branch for this test file
withNeonTestBranch();

describe('ContentAccessService Integration', () => {
  let db: Database;
  let accessService: ContentAccessService;
  let contentService: ContentService;
  let mediaService: MediaItemService;
  let r2Client: R2SigningClient;
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const config = { db, environment: 'test' };

    contentService = new ContentService(config);
    mediaService = new MediaItemService(config);

    // Use real R2 signing client with test bucket credentials
    r2Client = createR2SigningClientFromEnv();

    const obs = new ObservabilityClient('content-access-test', 'test');
    accessService = new ContentAccessService({
      db,
      r2: r2Client,
      obs,
    });

    const userIds = await seedTestUsers(db, 2);
    [userId, otherUserId] = userIds;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('getStreamingUrl', () => {
    it('should return streaming URL for free content without purchase', async () => {
      // Create media and content
      const media = await mediaService.create(
        {
          title: 'Free Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/free-video.mp4',
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
    });

    it('should return streaming URL for paid content with purchase', async () => {
      // Create media and paid content
      const media = await mediaService.create(
        {
          title: 'Premium Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/premium-video.mp4',
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
          title: 'Premium Course',
          slug: createUniqueSlug('premium-course'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 1999, // $19.99
          tags: [],
        },
        userId
      );

      await contentService.publish(paidContent.id, userId);

      // Grant access to otherUser via content_access
      await db.insert(contentAccess).values({
        userId: otherUserId,
        contentId: paidContent.id,
        accessType: 'purchased',
      });

      // User with access should be able to stream
      const result = await accessService.getStreamingUrl(otherUserId, {
        contentId: paidContent.id,
        expirySeconds: 3600,
      });

      expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
      expect(result.contentType).toBe('video');
    });

    it('should throw ACCESS_DENIED for paid content without purchase', async () => {
      // Create media and paid content
      const media = await mediaService.create(
        {
          title: 'Exclusive Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/exclusive-video.mp4',
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
          title: 'Exclusive Content',
          slug: createUniqueSlug('exclusive'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 4999, // $49.99
          tags: [],
        },
        userId
      );

      await contentService.publish(exclusiveContent.id, userId);

      // User without access should be denied
      await expect(
        accessService.getStreamingUrl(otherUserId, {
          contentId: exclusiveContent.id,
          expirySeconds: 3600,
        })
      ).rejects.toThrow('ACCESS_DENIED');
    });

    it('should throw CONTENT_NOT_FOUND for unpublished content', async () => {
      const media = await mediaService.create(
        {
          title: 'Draft Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/draft-video.mp4',
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
      ).rejects.toThrow('CONTENT_NOT_FOUND');
    });
  });

  describe('savePlaybackProgress', () => {
    it('should save new playback progress', async () => {
      const media = await mediaService.create(
        {
          title: 'Progress Test Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/progress-test.mp4',
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
          r2Key: 'originals/upsert-test.mp4',
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
          r2Key: 'originals/completion-test.mp4',
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
          r2Key: 'originals/no-progress.mp4',
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
          r2Key: 'originals/library-test.mp4',
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
          title: 'Library Test Content',
          slug: createUniqueSlug('library-test'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 999,
          tags: [],
        },
        userId
      );

      await contentService.publish(libraryContent.id, userId);

      // Simulate purchase by otherUser
      await db.insert(purchases).values({
        customerId: otherUserId,
        contentId: libraryContent.id,
        status: 'completed',
        amountPaidCents: 999,
      });

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
          r2Key: 'originals/in-progress.mp4',
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
          title: 'In Progress Content',
          slug: createUniqueSlug('in-progress'),
          contentType: 'video',
          mediaItemId: media1.id,
          visibility: 'purchased_only',
          priceCents: 500,
          tags: [],
        },
        userId
      );

      await contentService.publish(content1.id, userId);

      // Purchase and add partial progress
      await db.insert(purchases).values({
        customerId: testUserId,
        contentId: content1.id,
        status: 'completed',
        amountPaidCents: 500,
      });

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
        filter: 'in-progress',
        sortBy: 'recent',
      });

      expect(
        result.items.every((item) => item.progress && !item.progress.completed)
      ).toBe(true);
    });
  });
});
