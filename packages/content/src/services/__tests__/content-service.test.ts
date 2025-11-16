/**
 * Content Service Tests
 *
 * Comprehensive test suite for ContentService covering:
 * - Content creation (valid, invalid, with/without media)
 * - Content retrieval (by id, scope enforcement, 404s)
 * - Content updates (fields, validation, scope)
 * - Publish/unpublish/delete operations (state transitions)
 * - List operations (pagination, filtering, sorting)
 * - Slug uniqueness (per org and personal scopes)
 * - Scoping tests (creator ownership, org isolation)
 * - Error handling (all error types)
 *
 * Test Count: 40+ tests
 */

import { mediaItems, organizations } from '@codex/database/schema';
import {
  cleanupDatabase,
  createTestMediaItemInput,
  createTestOrganizationInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
} from '@codex/test-utils';
import type { CreateContentInput } from '@codex/validation';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ContentNotFoundError,
  ContentTypeMismatchError,
  MediaNotFoundError,
  MediaNotReadyError,
  SlugConflictError,
} from '../../errors';
import { ContentService } from '../content-service';

describe('ContentService', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;
  let otherCreatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });

    // Create test users
    const userIds = await seedTestUsers(db, 2);
    [creatorId, otherCreatorId] = userIds;
  });

  beforeEach(async () => {
    // Clean up all content tables between tests
    await cleanupDatabase(db);
  });

  afterAll(async () => {
    // Final cleanup
    await cleanupDatabase(db);
  });

  describe('create', () => {
    describe('valid content creation', () => {
      it('should create video content with media item', async () => {
        // Arrange: Create ready media item
        const [media] = await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning();

        const input: CreateContentInput = {
          title: 'Test Video Content',
          slug: createUniqueSlug('video'),
          description: 'Test description',
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        // Act
        const result = await service.create(input, creatorId);

        // Assert
        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
        expect(result.creatorId).toBe(creatorId);
        expect(result.title).toBe(input.title);
        expect(result.slug).toBe(input.slug);
        expect(result.contentType).toBe('video');
        expect(result.mediaItemId).toBe(media.id);
        expect(result.status).toBe('draft'); // Always starts as draft
        expect(result.visibility).toBe('public');
        expect(result.priceCents).toBe(0);
        expect(result.publishedAt).toBeNull();
        expect(result.viewCount).toBe(0);
        expect(result.purchaseCount).toBe(0);
      });

      it('should create audio content with media item', async () => {
        // Arrange
        const [media] = await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'audio',
              status: 'ready',
            })
          )
          .returning();

        const input: CreateContentInput = {
          title: 'Test Audio Content',
          slug: createUniqueSlug('audio'),
          description: 'Test audio',
          contentType: 'audio',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        // Act
        const result = await service.create(input, creatorId);

        // Assert
        expect(result.contentType).toBe('audio');
        expect(result.mediaItemId).toBe(media.id);
      });

      it('should create written content without media item', async () => {
        // Arrange
        const input: CreateContentInput = {
          title: 'Test Written Content',
          slug: createUniqueSlug('written'),
          description: 'Test written content',
          contentType: 'written',
          contentBody: 'This is the written content body.',
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        // Act
        const result = await service.create(input, creatorId);

        // Assert
        expect(result.contentType).toBe('written');
        expect(result.mediaItemId).toBeNull();
        expect(result.contentBody).toBe(input.contentBody);
      });

      it('should create content with organization', async () => {
        // Arrange: Create organization
        const [org] = await db
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

        const input: CreateContentInput = {
          title: 'Org Content',
          slug: createUniqueSlug('org-video'),
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        // Act
        const result = await service.create(input, creatorId);

        // Assert
        expect(result.organizationId).toBe(org.id);
      });

      it('should create personal content (no organization)', async () => {
        // Arrange
        const [media] = await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning();

        const input: CreateContentInput = {
          title: 'Personal Content',
          slug: createUniqueSlug('personal'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        // Act
        const result = await service.create(input, creatorId);

        // Assert
        expect(result.organizationId).toBeNull();
      });

      it('should create content with tags and category', async () => {
        // Arrange
        const [media] = await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning();

        const input: CreateContentInput = {
          title: 'Tagged Content',
          slug: createUniqueSlug('tagged'),
          contentType: 'video',
          mediaItemId: media.id,
          category: 'tutorials',
          tags: ['vitest', 'testing', 'typescript'],
          visibility: 'public',
          priceCents: 0,
        };

        // Act
        const result = await service.create(input, creatorId);

        // Assert
        expect(result.category).toBe('tutorials');
        expect(result.tags).toEqual(['vitest', 'testing', 'typescript']);
      });

      it('should create paid content with purchased_only visibility', async () => {
        // Arrange
        const [media] = await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning();

        const input: CreateContentInput = {
          title: 'Paid Content',
          slug: createUniqueSlug('paid'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 999, // $9.99
          tags: [],
        };

        // Act
        const result = await service.create(input, creatorId);

        // Assert
        expect(result.visibility).toBe('purchased_only');
        expect(result.priceCents).toBe(999);
      });
    });

    describe('media validation', () => {
      it('should throw MediaNotFoundError if media does not exist', async () => {
        // Arrange
        const input: CreateContentInput = {
          title: 'Content',
          slug: createUniqueSlug('test'),
          contentType: 'video',
          mediaItemId: '00000000-0000-0000-0000-000000000000', // Non-existent
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        // Act & Assert
        await expect(service.create(input, creatorId)).rejects.toThrow(
          MediaNotFoundError
        );
      });

      it('should throw MediaNotFoundError if media belongs to different creator', async () => {
        // Arrange: Create media for different creator
        const [media] = await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(otherCreatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning();

        const input: CreateContentInput = {
          title: 'Content',
          slug: createUniqueSlug('test'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        // Act & Assert
        await expect(service.create(input, creatorId)).rejects.toThrow(
          MediaNotFoundError
        );
      });

      it('should allow creating draft content with non-ready media', async () => {
        // Arrange: Create media in uploading status
        const [media] = await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'uploading', // Not ready
            })
          )
          .returning();

        const input: CreateContentInput = {
          title: 'Content',
          slug: createUniqueSlug('test'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        // Act: Create draft content with non-ready media (should succeed)
        const content = await service.create(input, creatorId);

        // Assert: Content created successfully as draft
        expect(content.id).toBeDefined();
        expect(content.status).toBe('draft');
        expect(content.mediaItemId).toBe(media.id);
      });

      it('should throw ContentTypeMismatchError if video content uses audio media', async () => {
        // Arrange: Create audio media
        const [media] = await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'audio',
              status: 'ready',
            })
          )
          .returning();

        const input: CreateContentInput = {
          title: 'Video Content',
          slug: createUniqueSlug('test'),
          contentType: 'video', // Mismatch: video content with audio media
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        // Act & Assert
        await expect(service.create(input, creatorId)).rejects.toThrow(
          ContentTypeMismatchError
        );
      });

      it('should throw ContentTypeMismatchError if audio content uses video media', async () => {
        // Arrange: Create video media
        const [media] = await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning();

        const input: CreateContentInput = {
          title: 'Audio Content',
          slug: createUniqueSlug('test'),
          contentType: 'audio', // Mismatch: audio content with video media
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        // Act & Assert
        await expect(service.create(input, creatorId)).rejects.toThrow(
          ContentTypeMismatchError
        );
      });
    });

    describe('slug uniqueness', () => {
      it('should throw SlugConflictError for duplicate personal content slug', async () => {
        // Arrange: Create first content
        const [media] = await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning();

        const slug = createUniqueSlug('duplicate');
        const input: CreateContentInput = {
          title: 'First Content',
          slug,
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        await service.create(input, creatorId);

        // Act & Assert: Try to create second content with same slug
        const input2: CreateContentInput = {
          title: 'Second Content',
          slug, // Same slug
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        await expect(service.create(input2, creatorId)).rejects.toThrow(
          SlugConflictError
        );
      });

      it('should throw SlugConflictError for duplicate organization content slug', async () => {
        // Arrange: Create organization and media
        const [org] = await db
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

        const slug = createUniqueSlug('org-duplicate');
        const input: CreateContentInput = {
          title: 'First Org Content',
          slug,
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        await service.create(input, creatorId);

        // Act & Assert: Try to create second content with same slug in same org
        const input2: CreateContentInput = {
          title: 'Second Org Content',
          slug, // Same slug
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org.id, // Same org
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        await expect(service.create(input2, creatorId)).rejects.toThrow(
          SlugConflictError
        );
      });

      it('should allow same slug in different organizations', async () => {
        // Arrange: Create two organizations
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

        const slug = createUniqueSlug('same-slug');

        // Act: Create content with same slug in different orgs
        const input1: CreateContentInput = {
          title: 'Org1 Content',
          slug,
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org1.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        const input2: CreateContentInput = {
          title: 'Org2 Content',
          slug, // Same slug
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org2.id, // Different org
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        const result1 = await service.create(input1, creatorId);
        const result2 = await service.create(input2, creatorId);

        // Assert: Both should succeed
        expect(result1.slug).toBe(slug);
        expect(result2.slug).toBe(slug);
        expect(result1.organizationId).not.toBe(result2.organizationId);
      });

      it('should allow same slug for personal and organization content', async () => {
        // Arrange
        const [org] = await db
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

        const slug = createUniqueSlug('shared-slug');

        // Act: Create personal content
        const personalInput: CreateContentInput = {
          title: 'Personal Content',
          slug,
          contentType: 'video',
          mediaItemId: media.id,
          // No organizationId = personal
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        // Create org content
        const orgInput: CreateContentInput = {
          title: 'Org Content',
          slug, // Same slug
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        };

        const personal = await service.create(personalInput, creatorId);
        const orgContent = await service.create(orgInput, creatorId);

        // Assert: Both should succeed
        expect(personal.slug).toBe(slug);
        expect(orgContent.slug).toBe(slug);
        expect(personal.organizationId).toBeNull();
        expect(orgContent.organizationId).toBe(org.id);
      });
    });
  });

  describe('get', () => {
    it('should retrieve content by id', async () => {
      // Arrange: Create content
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const input: CreateContentInput = {
        title: 'Test Content',
        slug: createUniqueSlug('get-test'),
        contentType: 'video',
        mediaItemId: media.id,
        visibility: 'public',
        priceCents: 0,
        tags: [],
      };

      const created = await service.create(input, creatorId);

      // Act
      const result = await service.get(created.id, creatorId);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.id).toBe(created.id);
      expect(result?.title).toBe(input.title);
      expect(result?.mediaItem).toBeDefined();
      expect(result?.mediaItem?.id).toBe(media.id);
    });

    it('should return null for non-existent content', async () => {
      // Act
      const result = await service.get(
        '00000000-0000-0000-0000-000000000000',
        creatorId
      );

      // Assert
      expect(result).toBeNull();
    });

    it('should return null if content belongs to different creator', async () => {
      // Arrange: Create content for other creator
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(otherCreatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const input: CreateContentInput = {
        title: 'Other Creator Content',
        slug: createUniqueSlug('other'),
        contentType: 'video',
        mediaItemId: media.id,
        visibility: 'public',
        priceCents: 0,
        tags: [],
      };

      const created = await service.create(input, otherCreatorId);

      // Act: Try to get as different creator
      const result = await service.get(created.id, creatorId);

      // Assert: Should not be able to access
      expect(result).toBeNull();
    });

    it('should return null for soft-deleted content', async () => {
      // Arrange: Create and delete content
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const input: CreateContentInput = {
        title: 'To Delete',
        slug: createUniqueSlug('delete'),
        contentType: 'video',
        mediaItemId: media.id,
        visibility: 'public',
        priceCents: 0,
        tags: [],
      };

      const created = await service.create(input, creatorId);
      await service.delete(created.id, creatorId);

      // Act
      const result = await service.get(created.id, creatorId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update content title', async () => {
      // Arrange
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const input: CreateContentInput = {
        title: 'Original Title',
        slug: createUniqueSlug('update'),
        contentType: 'video',
        mediaItemId: media.id,
        visibility: 'public',
        priceCents: 0,
        tags: [],
      };

      const created = await service.create(input, creatorId);

      // Act
      const updated = await service.update(
        created.id,
        { title: 'Updated Title' },
        creatorId
      );

      // Assert
      expect(updated.title).toBe('Updated Title');
      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        created.updatedAt.getTime()
      );
    });

    it('should update content description', async () => {
      // Arrange
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const created = await service.create(
        {
          title: 'Content',
          slug: createUniqueSlug('desc'),
          contentType: 'video',
          mediaItemId: media.id,
          description: 'Old description',
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      // Act
      const updated = await service.update(
        created.id,
        { description: 'New description' },
        creatorId
      );

      // Assert
      expect(updated.description).toBe('New description');
    });

    it('should update content visibility and price', async () => {
      // Arrange
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const created = await service.create(
        {
          title: 'Content',
          slug: createUniqueSlug('price'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      // Act
      const updated = await service.update(
        created.id,
        {
          visibility: 'purchased_only',
          priceCents: 1999, // $19.99
        },
        creatorId
      );

      // Assert
      expect(updated.visibility).toBe('purchased_only');
      expect(updated.priceCents).toBe(1999);
    });

    it('should throw ContentNotFoundError if content does not exist', async () => {
      // Act & Assert
      await expect(
        service.update(
          '00000000-0000-0000-0000-000000000000',
          { title: 'New Title' },
          creatorId
        )
      ).rejects.toThrow(ContentNotFoundError);
    });

    it('should throw ContentNotFoundError if updating other creator content', async () => {
      // Arrange: Create content for other creator
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(otherCreatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const created = await service.create(
        {
          title: 'Other Content',
          slug: createUniqueSlug('other'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        otherCreatorId
      );

      // Act & Assert: Try to update as different creator
      await expect(
        service.update(created.id, { title: 'Hacked' }, creatorId)
      ).rejects.toThrow(ContentNotFoundError);
    });
  });

  describe('publish', () => {
    it('should publish draft content', async () => {
      // Arrange
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const created = await service.create(
        {
          title: 'Draft Content',
          slug: createUniqueSlug('publish'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      expect(created.status).toBe('draft');

      // Act
      const published = await service.publish(created.id, creatorId);

      // Assert
      expect(published.status).toBe('published');
      expect(published.publishedAt).not.toBeNull();
      expect(published.publishedAt).toBeInstanceOf(Date);
    });

    it('should be idempotent (publishing already published content)', async () => {
      // Arrange: Create and publish
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const created = await service.create(
        {
          title: 'Content',
          slug: createUniqueSlug('idempotent'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      const firstPublish = await service.publish(created.id, creatorId);

      // Act: Publish again
      const secondPublish = await service.publish(created.id, creatorId);

      // Assert: Should return same result
      expect(secondPublish.status).toBe('published');
      expect(secondPublish.publishedAt).toEqual(firstPublish.publishedAt);
    });

    it.skip('should throw BusinessLogicError if video content has no media', async () => {
      // This should not happen in practice (validation prevents it),
      // but test the safeguard
      // We'll skip this test as create() prevents this scenario
    });

    it('should throw MediaNotReadyError if media is not ready', async () => {
      // Arrange: Create content with ready media, then manually update media to uploading
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const created = await service.create(
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

      // Update media to not ready
      await db
        .update(mediaItems)
        .set({ status: 'transcoding' })
        .where(eq(mediaItems.id, media.id));

      // Act & Assert
      await expect(service.publish(created.id, creatorId)).rejects.toThrow(
        MediaNotReadyError
      );
    });

    it('should publish written content without media', async () => {
      // Arrange
      const created = await service.create(
        {
          title: 'Written',
          slug: createUniqueSlug('written'),
          contentType: 'written',
          contentBody: 'Content body',
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      // Act
      const published = await service.publish(created.id, creatorId);

      // Assert
      expect(published.status).toBe('published');
      expect(published.publishedAt).not.toBeNull();
    });
  });

  describe('unpublish', () => {
    it('should unpublish published content', async () => {
      // Arrange: Create and publish
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const created = await service.create(
        {
          title: 'Content',
          slug: createUniqueSlug('unpublish'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      const published = await service.publish(created.id, creatorId);
      const originalPublishedAt = published.publishedAt;

      // Act
      const unpublished = await service.unpublish(created.id, creatorId);

      // Assert
      expect(unpublished.status).toBe('draft');
      expect(unpublished.publishedAt).toEqual(originalPublishedAt); // Keeps timestamp
    });

    it('should throw ContentNotFoundError if content does not exist', async () => {
      // Act & Assert
      await expect(
        service.unpublish('00000000-0000-0000-0000-000000000000', creatorId)
      ).rejects.toThrow(ContentNotFoundError);
    });
  });

  describe('delete', () => {
    it('should soft delete content', async () => {
      // Arrange
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const created = await service.create(
        {
          title: 'To Delete',
          slug: createUniqueSlug('delete'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      // Act
      await service.delete(created.id, creatorId);

      // Assert: Content should not be retrievable
      const result = await service.get(created.id, creatorId);
      expect(result).toBeNull();
    });

    it('should throw ContentNotFoundError if content does not exist', async () => {
      // Act & Assert
      await expect(
        service.delete('00000000-0000-0000-0000-000000000000', creatorId)
      ).rejects.toThrow(ContentNotFoundError);
    });

    it('should throw ContentNotFoundError if deleting other creator content', async () => {
      // Arrange
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(otherCreatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const created = await service.create(
        {
          title: 'Other Content',
          slug: createUniqueSlug('other'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        otherCreatorId
      );

      // Act & Assert
      await expect(service.delete(created.id, creatorId)).rejects.toThrow(
        ContentNotFoundError
      );
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      // Create test content for list tests
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      // Create 5 content items
      for (let i = 0; i < 5; i++) {
        await service.create(
          {
            title: `Content ${i}`,
            slug: createUniqueSlug(`list-${i}`),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'public',
            priceCents: 0,
            tags: [],
          },
          creatorId
        );
      }
    });

    it('should list all content for creator', async () => {
      // Act
      const result = await service.list(creatorId);

      // Assert
      expect(result.items).toHaveLength(5);
      expect(result.pagination.total).toBe(5);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('should paginate content list', async () => {
      // Act: Get page 1 with limit 2
      const page1 = await service.list(creatorId, {}, { page: 1, limit: 2 });

      // Assert page 1
      expect(page1.items).toHaveLength(2);
      expect(page1.pagination.page).toBe(1);
      expect(page1.pagination.limit).toBe(2);
      expect(page1.pagination.total).toBe(5);
      expect(page1.pagination.totalPages).toBe(3);

      // Act: Get page 2
      const page2 = await service.list(creatorId, {}, { page: 2, limit: 2 });

      // Assert page 2
      expect(page2.items).toHaveLength(2);
      expect(page2.pagination.page).toBe(2);

      // Assert different items
      expect(page1.items[0].id).not.toBe(page2.items[0].id);
    });

    it('should filter by status', async () => {
      // Arrange: Publish one content
      const allContent = await service.list(creatorId);
      await service.publish(allContent.items[0].id, creatorId);

      // Act: Filter by published
      const published = await service.list(creatorId, { status: 'published' });

      // Assert
      expect(published.items).toHaveLength(1);
      expect(published.items[0].status).toBe('published');

      // Act: Filter by draft
      const drafts = await service.list(creatorId, { status: 'draft' });

      // Assert
      expect(drafts.items).toHaveLength(4);
      drafts.items.forEach((item) => {
        expect(item.status).toBe('draft');
      });
    });

    it('should filter by content type', async () => {
      // Act
      const videos = await service.list(creatorId, { contentType: 'video' });

      // Assert: All content is video in this test
      expect(videos.items).toHaveLength(5);
    });

    it('should filter by visibility', async () => {
      // Act
      const publicContent = await service.list(creatorId, {
        visibility: 'public',
      });

      // Assert
      expect(publicContent.items).toHaveLength(5);
      publicContent.items.forEach((item) => {
        expect(item.visibility).toBe('public');
      });
    });

    it('should not return other creator content', async () => {
      // Arrange: Create content for other creator
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(otherCreatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      await service.create(
        {
          title: 'Other Content',
          slug: createUniqueSlug('other'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        otherCreatorId
      );

      // Act
      const result = await service.list(creatorId);

      // Assert: Should only see own content
      expect(result.items).toHaveLength(5);
      result.items.forEach((item) => {
        expect(item.creatorId).toBe(creatorId);
      });
    });

    it('should not return soft-deleted content', async () => {
      // Arrange: Delete one content
      const allContent = await service.list(creatorId);
      await service.delete(allContent.items[0].id, creatorId);

      // Act
      const result = await service.list(creatorId);

      // Assert
      expect(result.items).toHaveLength(4);
    });
  });
});
