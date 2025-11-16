/**
 * Integration Tests
 *
 * Cross-service integration tests covering:
 * - Full content creation workflows (org + media + content)
 * - End-to-end publishing workflows
 * - Complex scoping scenarios (personal vs org content)
 * - Media lifecycle with content dependencies
 * - Organization management with content
 *
 * Test Count: 15+ tests
 */

import { OrganizationService } from '@codex/identity';
import {
  cleanupDatabase,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
} from '@codex/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ContentService, MediaItemService } from '../services';

describe('Integration Tests', () => {
  let db: Database;
  let contentService: ContentService;
  let mediaService: MediaItemService;
  let orgService: OrganizationService;
  let creatorId: string;
  let otherCreatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const config = { db, environment: 'test' };

    contentService = new ContentService(config);
    mediaService = new MediaItemService(config);
    orgService = new OrganizationService(config);

    const userIds = await seedTestUsers(db, 2);
    [creatorId, otherCreatorId] = userIds;
  });

  beforeEach(async () => {
    await cleanupDatabase(db);
  });

  afterAll(async () => {
    await cleanupDatabase(db);
  });

  describe('full content creation workflow', () => {
    it('should create organization, media, and content in sequence', async () => {
      // Step 1: Create organization
      const org = await orgService.create({
        name: 'Test Company',
        slug: createUniqueSlug('company'),
        description: 'A test company',
      });

      expect(org.id).toBeDefined();

      // Step 2: Create media item
      const media = await mediaService.create(
        {
          title: 'Company Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/company-video.mp4',
          fileSizeBytes: 1024 * 1024 * 50,
        },
        creatorId
      );

      expect(media.id).toBeDefined();

      // Step 3: Mark media as ready (simulate transcoding complete)
      const readyMedia = await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/company/master.m3u8',
          thumbnailKey: 'thumbnails/company/thumb.jpg',
          durationSeconds: 180,
          width: 1920,
          height: 1080,
        },
        creatorId
      );

      expect(readyMedia.status).toBe('ready');

      // Step 4: Create content linked to org and media
      const content = await contentService.create(
        {
          title: 'Company Introduction',
          slug: createUniqueSlug('intro'),
          contentType: 'video',
          mediaItemId: readyMedia.id,
          organizationId: org.id,
          category: 'corporate',
          tags: ['intro', 'company', 'about'],
          visibility: 'public',
          priceCents: 0,
        },
        creatorId
      );

      expect(content.id).toBeDefined();
      expect(content.organizationId).toBe(org.id);
      expect(content.mediaItemId).toBe(readyMedia.id);

      // Step 5: Retrieve content with all relations
      const retrieved = await contentService.get(content.id, creatorId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.organization?.id).toBe(org.id);
      expect(retrieved?.mediaItem?.id).toBe(readyMedia.id);
      expect(retrieved?.mediaItem?.status).toBe('ready');
    });

    it('should create personal content without organization', async () => {
      // Create media
      const media = await mediaService.create(
        {
          title: 'Personal Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/personal.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        creatorId
      );

      await mediaService.updateStatus(media.id, 'ready', creatorId);

      // Create personal content (no organizationId)
      const content = await contentService.create(
        {
          title: 'My Personal Video',
          slug: createUniqueSlug('personal'),
          contentType: 'video',
          mediaItemId: media.id,
          // No organizationId
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      expect(content.organizationId).toBeNull();

      const retrieved = await contentService.get(content.id, creatorId);

      expect(retrieved?.organization).toBeNull();
    });
  });

  describe('end-to-end publishing workflow', () => {
    it('should handle complete publish workflow from upload to published', async () => {
      // 1. Create uploading media
      const media = await mediaService.create(
        {
          title: 'Tutorial Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/tutorial.mp4',
          fileSizeBytes: 1024 * 1024 * 100,
        },
        creatorId
      );

      expect(media.status).toBe('uploading');

      // 2. Mark as uploaded
      await mediaService.updateStatus(media.id, 'uploaded', creatorId);

      // 3. Mark as transcoding
      await mediaService.updateStatus(media.id, 'transcoding', creatorId);

      // 4. Mark as ready with metadata
      const ready = await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/tutorial/master.m3u8',
          thumbnailKey: 'thumbnails/tutorial/thumb.jpg',
          durationSeconds: 600,
          width: 1920,
          height: 1080,
        },
        creatorId
      );

      expect(ready.status).toBe('ready');

      // 5. Create content
      const content = await contentService.create(
        {
          title: 'Advanced Tutorial',
          slug: createUniqueSlug('tutorial'),
          contentType: 'video',
          mediaItemId: ready.id,
          visibility: 'purchased_only',
          priceCents: 1999,
          tags: [],
        },
        creatorId
      );

      expect(content.status).toBe('draft');

      // 6. Publish content
      const published = await contentService.publish(content.id, creatorId);

      expect(published.status).toBe('published');
      expect(published.publishedAt).not.toBeNull();

      // 7. Verify final state
      const final = await contentService.get(content.id, creatorId);
      expect(final?.status).toBe('published');
      expect(final?.mediaItem?.status).toBe('ready');
    });

    it('should prevent publishing content with non-ready media', async () => {
      // Create content with media in transcoding state
      const media = await mediaService.create(
        {
          title: 'Not Ready',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/not-ready.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await mediaService.updateStatus(media.id, 'transcoding', creatorId);

      const content = await contentService.create(
        {
          title: 'Content',
          slug: createUniqueSlug('not-ready'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      // Try to publish - should fail
      await expect(
        contentService.publish(content.id, creatorId)
      ).rejects.toThrow();
    });
  });

  describe('complex scoping scenarios', () => {
    it('should isolate content between different creators', async () => {
      // Creator 1 creates content
      const media1 = await mediaService.create(
        {
          title: 'Creator 1 Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/creator1.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await mediaService.updateStatus(media1.id, 'ready', creatorId);

      const content1 = await contentService.create(
        {
          title: 'Creator 1 Content',
          slug: createUniqueSlug('creator1'),
          contentType: 'video',
          mediaItemId: media1.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      // Creator 2 creates content
      const media2 = await mediaService.create(
        {
          title: 'Creator 2 Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/creator2.mp4',
          fileSizeBytes: 1024,
        },
        otherCreatorId
      );

      await mediaService.updateStatus(media2.id, 'ready', otherCreatorId);

      const content2 = await contentService.create(
        {
          title: 'Creator 2 Content',
          slug: createUniqueSlug('creator2'),
          contentType: 'video',
          mediaItemId: media2.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        otherCreatorId
      );

      // Verify isolation
      const creator1Content = await contentService.get(content1.id, creatorId);
      expect(creator1Content).not.toBeNull();

      const creator2Content = await contentService.get(
        content2.id,
        otherCreatorId
      );
      expect(creator2Content).not.toBeNull();

      // Creator 1 cannot see Creator 2's content
      const crossAccess1 = await contentService.get(content2.id, creatorId);
      expect(crossAccess1).toBeNull();

      // Creator 2 cannot see Creator 1's content
      const crossAccess2 = await contentService.get(
        content1.id,
        otherCreatorId
      );
      expect(crossAccess2).toBeNull();
    });

    it('should allow same slug in different organizations', async () => {
      const slug = createUniqueSlug('shared');

      // Create two organizations
      const org1 = await orgService.create({
        name: 'Organization 1',
        slug: createUniqueSlug('org1'),
      });

      const org2 = await orgService.create({
        name: 'Organization 2',
        slug: createUniqueSlug('org2'),
      });

      // Create media
      const media = await mediaService.create(
        {
          title: 'Shared Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/shared.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await mediaService.updateStatus(media.id, 'ready', creatorId);

      // Create content with same slug in both orgs
      const content1 = await contentService.create(
        {
          title: 'Org 1 Content',
          slug,
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org1.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      const content2 = await contentService.create(
        {
          title: 'Org 2 Content',
          slug, // Same slug
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org2.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      expect(content1.slug).toBe(slug);
      expect(content2.slug).toBe(slug);
      expect(content1.organizationId).not.toBe(content2.organizationId);
    });

    it('should enforce slug uniqueness within organization', async () => {
      const org = await orgService.create({
        name: 'Test Org',
        slug: createUniqueSlug('test-org'),
      });

      const media = await mediaService.create(
        {
          title: 'Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/test.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await mediaService.updateStatus(media.id, 'ready', creatorId);

      const slug = createUniqueSlug('unique-in-org');

      await contentService.create(
        {
          title: 'First Content',
          slug,
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      // Try to create second content with same slug in same org
      await expect(
        contentService.create(
          {
            title: 'Second Content',
            slug, // Same slug, same org
            contentType: 'video',
            mediaItemId: media.id,
            organizationId: org.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          creatorId
        )
      ).rejects.toThrow();
    });
  });

  describe('media lifecycle with content dependencies', () => {
    it('should allow deleting media that is not used by published content', async () => {
      const media = await mediaService.create(
        {
          title: 'Unused Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/unused.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      // Delete unused media - should succeed
      await mediaService.delete(media.id, creatorId);

      const deleted = await mediaService.get(media.id, creatorId);
      expect(deleted).toBeNull();
    });

    it('should handle content lifecycle after media status changes', async () => {
      // Create ready media and content
      const media = await mediaService.create(
        {
          title: 'Test Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/test.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/test/master.m3u8',
          thumbnailKey: 'thumbnails/test/thumb.jpg',
          durationSeconds: 120,
        },
        creatorId
      );

      const content = await contentService.create(
        {
          title: 'Test Content',
          slug: createUniqueSlug('lifecycle'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      // Publish content
      await contentService.publish(content.id, creatorId);

      // Content should remain published
      const published = await contentService.get(content.id, creatorId);
      expect(published?.status).toBe('published');
    });
  });

  describe('organization management with content', () => {
    it('should list all content in an organization', async () => {
      const org = await orgService.create({
        name: 'Test Company',
        slug: createUniqueSlug('company'),
      });

      const media = await mediaService.create(
        {
          title: 'Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/media.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await mediaService.updateStatus(media.id, 'ready', creatorId);

      // Create multiple content items for org
      for (let i = 0; i < 3; i++) {
        await contentService.create(
          {
            title: `Org Content ${i}`,
            slug: createUniqueSlug(`org-content-${i}`),
            contentType: 'video',
            mediaItemId: media.id,
            organizationId: org.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          creatorId
        );
      }

      // List content filtered by organization
      const orgContent = await contentService.list(creatorId, {
        organizationId: org.id,
      });

      expect(orgContent.items).toHaveLength(3);
      orgContent.items.forEach((item) => {
        expect(item.organizationId).toBe(org.id);
      });
    });

    it('should list personal content separately from org content', async () => {
      const org = await orgService.create({
        name: 'Test Org',
        slug: createUniqueSlug('test-org'),
      });

      const media = await mediaService.create(
        {
          title: 'Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/media.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await mediaService.updateStatus(media.id, 'ready', creatorId);

      // Create org content
      await contentService.create(
        {
          title: 'Org Content',
          slug: createUniqueSlug('org'),
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      // Create personal content
      await contentService.create(
        {
          title: 'Personal Content',
          slug: createUniqueSlug('personal'),
          contentType: 'video',
          mediaItemId: media.id,
          // No organizationId
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      // List org content
      const orgContent = await contentService.list(creatorId, {
        organizationId: org.id,
      });

      expect(orgContent.items).toHaveLength(1);
      expect(orgContent.items[0].organizationId).toBe(org.id);

      // List personal content (organizationId = null)
      const personalContent = await contentService.list(creatorId, {
        organizationId: null,
      });

      expect(personalContent.items).toHaveLength(1);
      expect(personalContent.items[0].organizationId).toBeNull();
    });

    it('should handle organization deletion with existing content', async () => {
      const org = await orgService.create({
        name: 'To Delete',
        slug: createUniqueSlug('delete-org'),
      });

      const media = await mediaService.create(
        {
          title: 'Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/media.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await mediaService.updateStatus(media.id, 'ready', creatorId);

      const content = await contentService.create(
        {
          title: 'Org Content',
          slug: createUniqueSlug('org-content'),
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      // Delete organization
      await orgService.delete(org.id);

      // Content should still exist but org is deleted
      const existingContent = await contentService.get(content.id, creatorId);
      expect(existingContent).not.toBeNull();
      expect(existingContent?.organizationId).toBe(org.id);

      // Organization should not be retrievable
      const deletedOrg = await orgService.get(org.id);
      expect(deletedOrg).toBeNull();
    });
  });

  describe('multi-creator collaboration scenarios', () => {
    it('should allow different creators to have content in same organization', async () => {
      const org = await orgService.create({
        name: 'Shared Org',
        slug: createUniqueSlug('shared'),
      });

      // Creator 1 media and content
      const media1 = await mediaService.create(
        {
          title: 'Creator 1 Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/creator1.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await mediaService.updateStatus(media1.id, 'ready', creatorId);

      const content1 = await contentService.create(
        {
          title: 'Creator 1 Content',
          slug: createUniqueSlug('creator1'),
          contentType: 'video',
          mediaItemId: media1.id,
          organizationId: org.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      // Creator 2 media and content
      const media2 = await mediaService.create(
        {
          title: 'Creator 2 Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/creator2.mp4',
          fileSizeBytes: 1024,
        },
        otherCreatorId
      );

      await mediaService.updateStatus(media2.id, 'ready', otherCreatorId);

      const content2 = await contentService.create(
        {
          title: 'Creator 2 Content',
          slug: createUniqueSlug('creator2'),
          contentType: 'video',
          mediaItemId: media2.id,
          organizationId: org.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        otherCreatorId
      );

      // Both content items belong to same org but different creators
      expect(content1.organizationId).toBe(org.id);
      expect(content2.organizationId).toBe(org.id);
      expect(content1.creatorId).toBe(creatorId);
      expect(content2.creatorId).toBe(otherCreatorId);

      // Each creator can only see their own content
      const creator1View = await contentService.get(content1.id, creatorId);
      expect(creator1View).not.toBeNull();

      const creator2View = await contentService.get(
        content2.id,
        otherCreatorId
      );
      expect(creator2View).not.toBeNull();

      // Cannot cross-access
      const crossView1 = await contentService.get(content2.id, creatorId);
      expect(crossView1).toBeNull();

      const crossView2 = await contentService.get(content1.id, otherCreatorId);
      expect(crossView2).toBeNull();
    });
  });
});
