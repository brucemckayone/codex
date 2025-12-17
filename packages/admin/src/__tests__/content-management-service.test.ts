/**
 * Admin Content Management Service Tests
 *
 * Comprehensive test suite for AdminContentManagementService covering:
 * - List all content with pagination and filtering
 * - Publish content (admin override)
 * - Unpublish content (admin override)
 * - Delete content (soft delete)
 * - Organization scoping enforcement
 * - Error handling
 *
 * Database Isolation:
 * - Uses neon-testing for ephemeral branch per test file
 * - Each test creates its own data (idempotent tests)
 */

import {
  content as contentTable,
  mediaItems,
  organizations,
} from '@codex/database/schema';
import { BusinessLogicError, NotFoundError } from '@codex/service-errors';
import {
  createTestMediaItemInput,
  createTestOrganizationInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminContentManagementService } from '../services/content-management-service';

describe('AdminContentManagementService', () => {
  let db: Database;
  let service: AdminContentManagementService;
  let creatorId: string;
  let orgId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new AdminContentManagementService({ db, environment: 'test' });

    // Create test user
    const userIds = await seedTestUsers(db, 1);
    [creatorId] = userIds;

    // Create organization
    const [org] = await db
      .insert(organizations)
      .values(createTestOrganizationInput())
      .returning();
    orgId = org.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('listAllContent', () => {
    it('should return empty list for organization with no content', async () => {
      const [emptyOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const result = await service.listAllContent(emptyOrg.id);

      expect(result.items).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
    });

    it('should list all non-deleted content for organization', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      // Create multiple content items
      for (let i = 0; i < 5; i++) {
        await db.insert(contentTable).values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: `Content ${i}`,
          slug: createUniqueSlug(`list-test-${i}`),
          contentType: 'video',
          status: i % 2 === 0 ? 'draft' : 'published',
          visibility: 'public',
          priceCents: 0,
        });
      }

      const result = await service.listAllContent(testOrg.id);

      expect(result.items.length).toBeGreaterThanOrEqual(5);
      expect(result.pagination.total).toBeGreaterThanOrEqual(5);
    });

    it('should paginate content correctly', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      // Create 10 content items
      for (let i = 0; i < 10; i++) {
        await db.insert(contentTable).values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: `Paginated Content ${i}`,
          slug: createUniqueSlug(`paginate-${i}`),
          contentType: 'video',
          status: 'draft',
          visibility: 'public',
          priceCents: 0,
        });
      }

      const page1 = await service.listAllContent(testOrg.id, {
        page: 1,
        limit: 3,
      });
      const page2 = await service.listAllContent(testOrg.id, {
        page: 2,
        limit: 3,
      });

      expect(page1.items).toHaveLength(3);
      expect(page1.pagination.page).toBe(1);
      expect(page2.items).toHaveLength(3);
      expect(page2.pagination.page).toBe(2);
      // Ensure different items on different pages
      expect(page1.items[0].id).not.toBe(page2.items[0].id);
    });

    it('should filter by status', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      // Create draft and published content
      await db.insert(contentTable).values([
        {
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Draft Content',
          slug: createUniqueSlug('draft-filter'),
          contentType: 'video',
          status: 'draft',
          visibility: 'public',
          priceCents: 0,
        },
        {
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Published Content',
          slug: createUniqueSlug('published-filter'),
          contentType: 'video',
          status: 'published',
          publishedAt: new Date(),
          visibility: 'public',
          priceCents: 0,
        },
      ]);

      const draftResult = await service.listAllContent(testOrg.id, {
        status: 'draft',
      });
      const publishedResult = await service.listAllContent(testOrg.id, {
        status: 'published',
      });

      expect(draftResult.items.every((c) => c.status === 'draft')).toBe(true);
      expect(publishedResult.items.every((c) => c.status === 'published')).toBe(
        true
      );
    });

    it('should exclude soft-deleted content', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      // Create one normal and one deleted content
      const [normalContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Normal Content',
          slug: createUniqueSlug('normal'),
          contentType: 'video',
          status: 'draft',
          visibility: 'public',
          priceCents: 0,
        })
        .returning();

      const [deletedContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Deleted Content',
          slug: createUniqueSlug('deleted'),
          contentType: 'video',
          status: 'draft',
          visibility: 'public',
          priceCents: 0,
          deletedAt: new Date(),
        })
        .returning();

      const result = await service.listAllContent(testOrg.id);

      const ids = result.items.map((c) => c.id);
      expect(ids).toContain(normalContent.id);
      expect(ids).not.toContain(deletedContent.id);
    });

    // Note: Organization existence validation is handled by middleware (requirePlatformOwner)
    // Service trusts that organizationId is valid when passed from authenticated context
  });

  describe('publishContent', () => {
    it('should publish draft content', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [draft] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Draft to Publish',
          slug: createUniqueSlug('publish-test'),
          contentType: 'video',
          status: 'draft',
          visibility: 'public',
          priceCents: 0,
        })
        .returning();

      const published = await service.publishContent(testOrg.id, draft.id);

      expect(published.status).toBe('published');
      expect(published.publishedAt).not.toBeNull();
    });

    it('should be idempotent (publishing already published content)', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [content] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Already Published',
          slug: createUniqueSlug('idempotent-publish'),
          contentType: 'video',
          status: 'published',
          publishedAt: new Date(),
          visibility: 'public',
          priceCents: 0,
        })
        .returning();

      const result = await service.publishContent(testOrg.id, content.id);

      expect(result.status).toBe('published');
    });

    it('should throw BusinessLogicError for video content without ready media', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'transcoding', // Not ready
          })
        )
        .returning();

      const [content] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Not Ready Content',
          slug: createUniqueSlug('not-ready'),
          contentType: 'video',
          status: 'draft',
          visibility: 'public',
          priceCents: 0,
        })
        .returning();

      await expect(
        service.publishContent(testOrg.id, content.id)
      ).rejects.toThrow(BusinessLogicError);
    });

    it('should publish written content without media', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [content] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          title: 'Written Content',
          slug: createUniqueSlug('written-publish'),
          contentType: 'written',
          contentBody: 'This is written content',
          status: 'draft',
          visibility: 'public',
          priceCents: 0,
        })
        .returning();

      const published = await service.publishContent(testOrg.id, content.id);

      expect(published.status).toBe('published');
    });

    it('should throw NotFoundError for content from different organization', async () => {
      const [org1] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();
      const [org2] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [content] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: org1.id,
          mediaItemId: media.id,
          title: 'Org1 Content',
          slug: createUniqueSlug('cross-org'),
          contentType: 'video',
          status: 'draft',
          visibility: 'public',
          priceCents: 0,
        })
        .returning();

      // Try to publish content from org1 using org2
      await expect(service.publishContent(org2.id, content.id)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('unpublishContent', () => {
    it('should unpublish published content', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [content] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Published Content',
          slug: createUniqueSlug('unpublish-test'),
          contentType: 'video',
          status: 'published',
          publishedAt: new Date(),
          visibility: 'public',
          priceCents: 0,
        })
        .returning();

      const unpublished = await service.unpublishContent(
        testOrg.id,
        content.id
      );

      expect(unpublished.status).toBe('draft');
    });

    it('should be idempotent (unpublishing already draft content)', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [content] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Already Draft',
          slug: createUniqueSlug('idempotent-unpublish'),
          contentType: 'video',
          status: 'draft',
          visibility: 'public',
          priceCents: 0,
        })
        .returning();

      const result = await service.unpublishContent(testOrg.id, content.id);

      expect(result.status).toBe('draft');
    });

    it('should throw NotFoundError for non-existent content', async () => {
      await expect(
        service.unpublishContent(orgId, '00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteContent', () => {
    it('should soft delete content', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [content] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'To Delete',
          slug: createUniqueSlug('delete-test'),
          contentType: 'video',
          status: 'draft',
          visibility: 'public',
          priceCents: 0,
        })
        .returning();

      const result = await service.deleteContent(testOrg.id, content.id);

      expect(result).toBe(true);

      // Verify content is no longer returned in list
      const list = await service.listAllContent(testOrg.id);
      expect(list.items.find((c) => c.id === content.id)).toBeUndefined();
    });

    it('should throw NotFoundError for content from different organization', async () => {
      const [org1] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();
      const [org2] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [content] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: org1.id,
          mediaItemId: media.id,
          title: 'Cross Org Delete',
          slug: createUniqueSlug('cross-org-delete'),
          contentType: 'video',
          status: 'draft',
          visibility: 'public',
          priceCents: 0,
        })
        .returning();

      // Try to delete content from org1 using org2
      await expect(service.deleteContent(org2.id, content.id)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw NotFoundError for already deleted content', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [content] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Already Deleted',
          slug: createUniqueSlug('already-deleted'),
          contentType: 'video',
          status: 'draft',
          visibility: 'public',
          priceCents: 0,
          deletedAt: new Date(),
        })
        .returning();

      await expect(
        service.deleteContent(testOrg.id, content.id)
      ).rejects.toThrow(NotFoundError);
    });
  });
});
