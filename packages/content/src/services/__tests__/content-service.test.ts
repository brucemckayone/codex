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
 *
 * Database Isolation:
 * - Uses neon-testing for ephemeral branch per test file
 * - Each test creates its own data (idempotent tests)
 * - No cleanup needed - fresh database for this file
 */

import { CacheType } from '@codex/cache';
import {
  content,
  mediaItems,
  organizations,
  stripeConnectAccounts,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  createTestConnectAccountInput,
  createTestMediaItemInput,
  createTestOrganizationInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  gateContentToTiers,
  joinTeam,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import type { CreateContentInput } from '@codex/validation';
import { eq, inArray } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  ContentNotFoundError,
  ContentTypeMismatchError,
  CreatorPayoutsRequiredError,
  MediaNotFoundError,
  MediaNotReadyError,
  SlugConflictError,
} from '../../errors';
import { ContentService } from '../content-service';

// Uses workflow-level Neon branch in CI, LOCAL_PROXY locally

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

  // No cleanup needed - neon-testing provides fresh database per file

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('create', () => {
    describe('valid content creation', () => {
      it('should create video content with media item', async () => {
        // Arrange: Create ready media item
        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'video',
                status: 'ready',
              })
            )
            .returning()
        );

        const input: CreateContentInput = {
          title: 'Test Video Content',
          slug: createUniqueSlug('video'),
          description: 'Test description',
          contentType: 'video',
          mediaItemId: media.id,
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
        expect(result.isFree).toBe(true);
        expect(result.priceCents).toBe(0);
        expect(result.publishedAt).toBeNull();
        expect(result.viewCount).toBe(0);
        expect(result.purchaseCount).toBe(0);
      });

      it('should create audio content with media item', async () => {
        // Arrange
        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'audio',
                status: 'ready',
              })
            )
            .returning()
        );

        const input: CreateContentInput = {
          title: 'Test Audio Content',
          slug: createUniqueSlug('audio'),
          description: 'Test audio',
          contentType: 'audio',
          mediaItemId: media.id,
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
        const org = takeFirst(
          await db
            .insert(organizations)
            .values(createTestOrganizationInput())
            .returning()
        );
        await joinTeam(db, org.id, creatorId);

        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'video',
                status: 'ready',
              })
            )
            .returning()
        );

        const input: CreateContentInput = {
          title: 'Org Content',
          slug: createUniqueSlug('org-video'),
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org.id,
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
        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'video',
                status: 'ready',
              })
            )
            .returning()
        );

        const input: CreateContentInput = {
          title: 'Personal Content',
          slug: createUniqueSlug('personal'),
          contentType: 'video',
          mediaItemId: media.id,
          priceCents: 0,
          tags: [],
        };

        // Act
        const result = await service.create(input, creatorId);

        // Assert
        expect(result.organizationId).toBeNull();
      });

      it('rejects orgless content with a minimumTierId set (Codex-up7bx)', async () => {
        // subscription_tiers is org-scoped, so a tier on orgless content is
        // a semantically invalid row. The write schema rejects it at create().
        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'video',
                status: 'ready',
              })
            )
            .returning()
        );

        const input = {
          title: 'Orgless Tier Content',
          slug: createUniqueSlug('orgless-tier'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          isPurchasable: true,
          priceCents: 1000,
          // no organizationId
          includedInTierId: '123e4567-e89b-12d3-a456-426614174000',
          tags: [],
        } as unknown as CreateContentInput;

        await expect(service.create(input, creatorId)).rejects.toThrow(
          /orgless content cannot be tier-gated/i
        );
      });

      it('refuses to move tier-gated content out of its org (Codex-2hxff.91)', async () => {
        // The old clamp (Codex-up7bx) nulled the tier on an orgless move,
        // which read as FREE. The ticks are pinned to the org, so the service
        // now refuses the move instead, and nothing changes.
        const org = takeFirst(
          await db
            .insert(organizations)
            .values(createTestOrganizationInput())
            .returning()
        );
        await joinTeam(db, org.id, creatorId);
        const otherOrg = takeFirst(
          await db
            .insert(organizations)
            .values(createTestOrganizationInput())
            .returning()
        );
        await joinTeam(db, otherOrg.id, creatorId);

        const tier = takeFirst(
          await db
            .insert(subscriptionTiers)
            .values(createTestTierInput(org.id, { sortOrder: 1 }))
            .returning()
        );

        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'video',
                status: 'ready',
              })
            )
            .returning()
        );

        // Insert a valid org-scoped tier-gated row directly (bypasses the
        // create schema, mirroring how legitimate subscriber content lands).
        const seeded = takeFirst(
          await db
            .insert(content)
            .values({
              creatorId,
              organizationId: org.id,
              mediaItemId: media.id,
              title: 'Org Tier Content',
              slug: createUniqueSlug('org-tier'),
              contentType: 'video',
              isFree: false,
              isTierGated: true,
              status: 'draft',
            })
            .returning()
        );
        await gateContentToTiers(db, {
          contentId: seeded.id,
          organizationId: org.id,
          tierIds: [tier.id],
        });

        // Orgless, WITHOUT touching the tier fields in the payload.
        await expect(
          service.update(seeded.id, { organizationId: null }, creatorId)
        ).rejects.toThrow(/orgless content cannot be tier-gated/i);
        // Another org: the ticks would point at the old org's tier.
        await expect(
          service.update(seeded.id, { organizationId: otherOrg.id }, creatorId)
        ).rejects.toThrow(/remove this item from plans/i);

        const after = await service.get(seeded.id, creatorId);
        expect(after?.organizationId).toBe(org.id);
        expect(after?.isTierGated).toBe(true);
        expect(after?.includedInTierIds).toEqual([tier.id]);
      });

      it('should create content with tags and category', async () => {
        // Arrange
        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'video',
                status: 'ready',
              })
            )
            .returning()
        );

        const input: CreateContentInput = {
          title: 'Tagged Content',
          slug: createUniqueSlug('tagged'),
          contentType: 'video',
          mediaItemId: media.id,
          category: 'tutorials',
          tags: ['vitest', 'testing', 'typescript'],
          priceCents: 0,
        };

        // Act
        const result = await service.create(input, creatorId);

        // Assert
        expect(result.category).toBe('tutorials');
        expect(result.tags).toEqual(['vitest', 'testing', 'typescript']);
      });

      it('should create paid content with paid access type', async () => {
        // Arrange
        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'video',
                status: 'ready',
              })
            )
            .returning()
        );

        const input: CreateContentInput = {
          title: 'Paid Content',
          slug: createUniqueSlug('paid'),
          contentType: 'video',
          mediaItemId: media.id,
          isPurchasable: true,
          priceCents: 999, // £9.99
          tags: [],
        };

        // Act
        const result = await service.create(input, creatorId);

        // Assert
        expect(result.isPurchasable).toBe(true);
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
        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(otherCreatorId, {
                mediaType: 'video',
                status: 'ready',
              })
            )
            .returning()
        );

        const input: CreateContentInput = {
          title: 'Content',
          slug: createUniqueSlug('test'),
          contentType: 'video',
          mediaItemId: media.id,
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
        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'video',
                status: 'uploading', // Not ready
              })
            )
            .returning()
        );

        const input: CreateContentInput = {
          title: 'Content',
          slug: createUniqueSlug('test'),
          contentType: 'video',
          mediaItemId: media.id,
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
        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'audio',
                status: 'ready',
              })
            )
            .returning()
        );

        const input: CreateContentInput = {
          title: 'Video Content',
          slug: createUniqueSlug('test'),
          contentType: 'video', // Mismatch: video content with audio media
          mediaItemId: media.id,
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
        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'video',
                status: 'ready',
              })
            )
            .returning()
        );

        const input: CreateContentInput = {
          title: 'Audio Content',
          slug: createUniqueSlug('test'),
          contentType: 'audio', // Mismatch: audio content with video media
          mediaItemId: media.id,
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
        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'video',
                status: 'ready',
              })
            )
            .returning()
        );

        const slug = createUniqueSlug('duplicate');
        const input: CreateContentInput = {
          title: 'First Content',
          slug,
          contentType: 'video',
          mediaItemId: media.id,
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
          priceCents: 0,
          tags: [],
        };

        await expect(service.create(input2, creatorId)).rejects.toThrow(
          SlugConflictError
        );
      });

      it('should throw SlugConflictError for duplicate organization content slug', async () => {
        // Arrange: Create organization and media
        const org = takeFirst(
          await db
            .insert(organizations)
            .values(createTestOrganizationInput())
            .returning()
        );
        await joinTeam(db, org.id, creatorId);

        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'video',
                status: 'ready',
              })
            )
            .returning()
        );

        const slug = createUniqueSlug('org-duplicate');
        const input: CreateContentInput = {
          title: 'First Org Content',
          slug,
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org.id,
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
          priceCents: 0,
          tags: [],
        };

        await expect(service.create(input2, creatorId)).rejects.toThrow(
          SlugConflictError
        );
      });

      it('should allow same slug in different organizations', async () => {
        // Arrange: Create two organizations
        const org1 = takeFirst(
          await db
            .insert(organizations)
            .values(createTestOrganizationInput())
            .returning()
        );
        await joinTeam(db, org1.id, creatorId);

        const org2 = takeFirst(
          await db
            .insert(organizations)
            .values(createTestOrganizationInput())
            .returning()
        );
        await joinTeam(db, org2.id, creatorId);

        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'video',
                status: 'ready',
              })
            )
            .returning()
        );

        const slug = createUniqueSlug('same-slug');

        // Act: Create content with same slug in different orgs
        const input1: CreateContentInput = {
          title: 'Org1 Content',
          slug,
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org1.id,
          priceCents: 0,
          tags: [],
        };

        const input2: CreateContentInput = {
          title: 'Org2 Content',
          slug, // Same slug
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: org2.id, // Different org
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
        const org = takeFirst(
          await db
            .insert(organizations)
            .values(createTestOrganizationInput())
            .returning()
        );
        await joinTeam(db, org.id, creatorId);

        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'video',
                status: 'ready',
              })
            )
            .returning()
        );

        const slug = createUniqueSlug('shared-slug');

        // Act: Create personal content
        const personalInput: CreateContentInput = {
          title: 'Personal Content',
          slug,
          contentType: 'video',
          mediaItemId: media.id,
          // No organizationId = personal
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
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const input: CreateContentInput = {
        title: 'Test Content',
        slug: createUniqueSlug('get-test'),
        contentType: 'video',
        mediaItemId: media.id,
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

    it("serves its media without the transcoder's raw detail", async () => {
      // A row that still holds detail (Codex-l2c48): the database keeps it,
      // no response may carry it.
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
              transcodingError: 'botocore: https://internal.example said 503',
            })
          )
          .returning()
      );
      const created = await service.create(
        {
          title: 'Detail test',
          slug: createUniqueSlug('detail-test'),
          contentType: 'video',
          mediaItemId: media.id,
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      const result = await service.get(created.id, creatorId);

      expect(result?.mediaItem?.id).toBe(media.id);
      expect(result?.mediaItem).not.toHaveProperty('transcodingError');
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
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(otherCreatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const input: CreateContentInput = {
        title: 'Other Creator Content',
        slug: createUniqueSlug('other'),
        contentType: 'video',
        mediaItemId: media.id,
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
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const input: CreateContentInput = {
        title: 'To Delete',
        slug: createUniqueSlug('delete'),
        contentType: 'video',
        mediaItemId: media.id,
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
    it('refuses a slug another piece holds as a conflict, as create does', async () => {
      const first = await service.create(
        {
          title: 'First draft',
          slug: createUniqueSlug('held'),
          contentType: 'written',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );
      const second = await service.create(
        {
          title: 'Second draft',
          slug: createUniqueSlug('mover'),
          contentType: 'written',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      await expect(
        service.update(second.id, { slug: first.slug }, creatorId)
      ).rejects.toThrow(SlugConflictError);
    });

    it('refuses a move into an org where its slug is taken, naming that slug', async () => {
      const org = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      await joinTeam(db, org.id, creatorId);
      const slug = createUniqueSlug('org-held');
      await service.create(
        {
          title: 'In the org',
          slug,
          contentType: 'written',
          organizationId: org.id,
          priceCents: 0,
          tags: [],
        },
        creatorId
      );
      // The same slug, personal: the personal index lets it be.
      const personal = await service.create(
        {
          title: 'Personal',
          slug,
          contentType: 'written',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      await expect(
        service.update(personal.id, { organizationId: org.id }, creatorId)
      ).rejects.toMatchObject({ code: 'CONFLICT', context: { slug } });
    });

    it('should update content title', async () => {
      // Arrange
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const input: CreateContentInput = {
        title: 'Original Title',
        slug: createUniqueSlug('update'),
        contentType: 'video',
        mediaItemId: media.id,
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
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const created = await service.create(
        {
          title: 'Content',
          slug: createUniqueSlug('desc'),
          contentType: 'video',
          mediaItemId: media.id,
          description: 'Old description',
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

    it('should update content access type and price', async () => {
      // Arrange
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const created = await service.create(
        {
          title: 'Content',
          slug: createUniqueSlug('price'),
          contentType: 'video',
          mediaItemId: media.id,
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      // Act
      const updated = await service.update(
        created.id,
        {
          isFree: false,
          isPurchasable: true,
          priceCents: 1999, // £19.99
        },
        creatorId
      );

      // Assert
      expect(updated.isPurchasable).toBe(true);
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
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(otherCreatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const created = await service.create(
        {
          title: 'Other Content',
          slug: createUniqueSlug('other'),
          contentType: 'video',
          mediaItemId: media.id,
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

    describe('isFree clamp — non-free ⟺ ≥1 gate (partial-PATCH bypass guard)', () => {
      // Regression guard: a partial PATCH that clears the SOLE gate without
      // restating isFree must NOT persist a zero-gate row with isFree:false —
      // the resolver falls through team/follower/tier/paid to `return true`, so
      // such a row is silently PUBLIC. update() recomputes the effective merged
      // policy and clamps isFree:true when no gate remains (a gate-less row IS
      // free). The Zod refine can't catch this — a partial has no existing row.

      /** Seed a gated (isFree:false) video row directly, bypassing the create
       *  schema — mirrors how a legitimately-gated row lands in the table. */
      async function seedGated(flags: {
        isPurchasable?: boolean;
        priceCents?: number | null;
        isFollowerGated?: boolean;
        isTeamOnly?: boolean;
        /** Ticked tiers: turns the tier switch on (needs `organizationId`). */
        tierIds?: string[];
        organizationId?: string | null;
      }): Promise<string> {
        const { tierIds, ...policy } = flags;
        const media = takeFirst(
          await db
            .insert(mediaItems)
            .values(
              createTestMediaItemInput(creatorId, {
                mediaType: 'video',
                status: 'ready',
              })
            )
            .returning()
        );
        const row = takeFirst(
          await db
            .insert(content)
            .values({
              creatorId,
              mediaItemId: media.id,
              title: 'Gated Content',
              slug: createUniqueSlug('gated'),
              contentType: 'video',
              isFree: false,
              status: 'draft',
              ...policy,
              isTierGated: tierIds !== undefined,
            })
            .returning()
        );
        if (tierIds !== undefined && policy.organizationId) {
          await gateContentToTiers(db, {
            contentId: row.id,
            organizationId: policy.organizationId,
            tierIds,
          });
        }
        return row.id;
      }

      it('clearing a subscriber tier makes the row FREE, not a zero-gate public row', async () => {
        const org = takeFirst(
          await db
            .insert(organizations)
            .values(createTestOrganizationInput())
            .returning()
        );
        const tier = takeFirst(
          await db
            .insert(subscriptionTiers)
            .values(createTestTierInput(org.id, { sortOrder: 1 }))
            .returning()
        );
        const id = await seedGated({
          organizationId: org.id,
          tierIds: [tier.id],
        });

        // Partial PATCH clears the sole gate WITHOUT restating isFree (the
        // legacy single-tier input: null = switch off).
        const updated = await service.update(
          id,
          { includedInTierId: null },
          creatorId
        );

        expect(updated.includedInTierId).toBeNull();
        expect(updated.isTierGated).toBe(false);
        expect(updated.includedInTierIds).toEqual([]);
        expect(updated.isFree).toBe(true); // clamped — never non-free + zero-gate
        expect(updated.isPurchasable).toBe(false);
        expect(updated.isFollowerGated).toBe(false);
        expect(updated.isTeamOnly).toBe(false);
      });

      it('clearing the follower gate makes the row FREE', async () => {
        const id = await seedGated({ isFollowerGated: true });
        const updated = await service.update(
          id,
          { isFollowerGated: false },
          creatorId
        );
        expect(updated.isFollowerGated).toBe(false);
        expect(updated.isFree).toBe(true);
      });

      it('clearing the team gate makes the row FREE', async () => {
        const id = await seedGated({ isTeamOnly: true });
        const updated = await service.update(
          id,
          { isTeamOnly: false },
          creatorId
        );
        expect(updated.isTeamOnly).toBe(false);
        expect(updated.isFree).toBe(true);
      });

      it('clearing the paid gate makes the row FREE', async () => {
        const id = await seedGated({ isPurchasable: true, priceCents: 1500 });
        const updated = await service.update(
          id,
          { isPurchasable: false, priceCents: null },
          creatorId
        );
        expect(updated.isPurchasable).toBe(false);
        expect(updated.isFree).toBe(true);
      });

      it('does NOT clamp when another gate remains (hybrid drops price, keeps tier)', async () => {
        const org = takeFirst(
          await db
            .insert(organizations)
            .values(createTestOrganizationInput())
            .returning()
        );
        const tier = takeFirst(
          await db
            .insert(subscriptionTiers)
            .values(createTestTierInput(org.id, { sortOrder: 1 }))
            .returning()
        );
        const id = await seedGated({
          organizationId: org.id,
          isPurchasable: true,
          priceCents: 1500,
          tierIds: [tier.id],
        });

        const updated = await service.update(
          id,
          { isPurchasable: false, priceCents: null },
          creatorId
        );

        expect(updated.isPurchasable).toBe(false);
        expect(updated.includedInTierId).toBe(tier.id); // tier gate remains
        expect(updated.includedInTierIds).toEqual([tier.id]);
        expect(updated.isFree).toBe(false); // still gated → NOT clamped free
      });
    });
  });

  describe('publish', () => {
    it('should publish draft content', async () => {
      // Arrange
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const created = await service.create(
        {
          title: 'Draft Content',
          slug: createUniqueSlug('publish'),
          contentType: 'video',
          mediaItemId: media.id,
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
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const created = await service.create(
        {
          title: 'Content',
          slug: createUniqueSlug('idempotent'),
          contentType: 'video',
          mediaItemId: media.id,
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

    it('republishing an item taken off sale on a departure clears the stamp (Codex-2hxff.64)', async () => {
      const created = await service.create(
        {
          title: 'Back on sale',
          slug: createUniqueSlug('republish'),
          contentType: 'written',
          contentBody: 'Body',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );
      await service.publish(created.id, creatorId);
      // What a removal leaves (withdrawCatalogueOnDeparture).
      await db
        .update(content)
        .set({ status: 'archived', offSaleAt: new Date() })
        .where(eq(content.id, created.id));

      const republished = await service.publish(created.id, creatorId);

      // Without the clear, tier access would still end at the next renewal.
      expect(republished.status).toBe('published');
      expect(republished.offSaleAt).toBeNull();
    });

    // A draft needs only a title and a type (Codex-a6ofh.2.1), so each rule
    // below is reached at publish: the draft saves, its publish refuses, and
    // the refusal names the rule for the editor's checklist.
    it.each([
      'video',
      'audio',
    ] as const)('refuses a %s draft with no media (MEDIA_REQUIRED)', async (contentType) => {
      const draft = await service.create(
        {
          title: 'No media yet',
          slug: createUniqueSlug(`no-media-${contentType}`),
          contentType,
          tags: [],
        },
        creatorId
      );

      await expect(service.publish(draft.id, creatorId)).rejects.toMatchObject({
        statusCode: 422,
        context: { code: 'MEDIA_REQUIRED' },
      });
    });

    it.each([
      ['no body', undefined],
      [
        'an emptied editor',
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
      ],
    ])('refuses an article with %s (BODY_REQUIRED)', async (_case, contentBody) => {
      const draft = await service.create(
        {
          title: 'Nothing written',
          slug: createUniqueSlug('no-body'),
          contentType: 'written',
          contentBody,
          tags: [],
        },
        creatorId
      );

      await expect(service.publish(draft.id, creatorId)).rejects.toMatchObject({
        statusCode: 422,
        context: { code: 'BODY_REQUIRED' },
      });
    });

    it('publishes an article whose body is a TipTap doc with text', async () => {
      const draft = await service.create(
        {
          title: 'Written in the editor',
          slug: createUniqueSlug('doc-body'),
          contentType: 'written',
          contentBody: JSON.stringify({
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] },
            ],
          }),
          tags: [],
        },
        creatorId
      );

      const published = await service.publish(draft.id, creatorId);
      expect(published.status).toBe('published');
    });

    it.each([
      ['no price', undefined],
      ['a zero price', 0],
    ])('refuses a piece for sale with %s (PRICE_REQUIRED)', async (_case, priceCents) => {
      const draft = await service.create(
        {
          title: 'For sale, unpriced',
          slug: createUniqueSlug('no-price'),
          contentType: 'written',
          contentBody: 'Body',
          isPurchasable: true,
          priceCents,
          tags: [],
        },
        creatorId
      );

      await expect(service.publish(draft.id, creatorId)).rejects.toMatchObject({
        statusCode: 422,
        context: { code: 'PRICE_REQUIRED' },
      });
    });

    it('should throw MediaNotReadyError if media is not ready', async () => {
      // Arrange: Create content with ready media, then manually update media to uploading
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const created = await service.create(
        {
          title: 'Content',
          slug: createUniqueSlug('not-ready'),
          contentType: 'video',
          mediaItemId: media.id,
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
      const refusal = service.publish(created.id, creatorId);
      await expect(refusal).rejects.toThrow(MediaNotReadyError);
      // Still processing and failed read differently: one will finish.
      await expect(refusal).rejects.toMatchObject({
        context: { mediaStatus: 'transcoding', code: 'MEDIA_NOT_READY' },
      });
    });

    it('should publish written content without media', async () => {
      // Arrange
      const created = await service.create(
        {
          title: 'Written',
          slug: createUniqueSlug('written'),
          contentType: 'written',
          contentBody: 'Content body',
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

  // Codex-a6ofh.2.1 (review): the media, body and price rules left the create
  // schema for publish, so a save of a LIVE piece is where they must hold too.
  // A draft saves without them; publish judges it.
  describe('update of a live piece keeps it complete', () => {
    async function liveArticle(): Promise<string> {
      const draft = await service.create(
        {
          title: 'Live article',
          slug: createUniqueSlug('live-article'),
          contentType: 'written',
          contentBody: 'Words',
          tags: [],
        },
        creatorId
      );
      await service.publish(draft.id, creatorId);
      return draft.id;
    }

    it('refuses detaching a live video from its media (MEDIA_REQUIRED), and keeps it', async () => {
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );
      const draft = await service.create(
        {
          title: 'Live video',
          slug: createUniqueSlug('live-video'),
          contentType: 'video',
          mediaItemId: media.id,
          tags: [],
        },
        creatorId
      );
      await service.publish(draft.id, creatorId);

      await expect(
        service.update(draft.id, { mediaItemId: null }, creatorId)
      ).rejects.toMatchObject({
        statusCode: 422,
        context: { code: 'MEDIA_REQUIRED' },
      });
      const [row] = await db
        .select({ mediaItemId: content.mediaItemId })
        .from(content)
        .where(eq(content.id, draft.id));
      expect(row?.mediaItemId).toBe(media.id);
    });

    it.each([
      [
        'an emptied editor',
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
      ],
      ['an empty string', ''],
    ])('refuses emptying a live article to %s (BODY_REQUIRED)', async (_case, contentBody) => {
      const id = await liveArticle();

      await expect(
        service.update(id, { contentBody }, creatorId)
      ).rejects.toMatchObject({
        statusCode: 422,
        context: { code: 'BODY_REQUIRED' },
      });
    });

    it.each([
      ['no price', null],
      ['a zero price', 0],
    ])('refuses putting a live piece on sale with %s (PRICE_REQUIRED)', async (_case, priceCents) => {
      const id = await liveArticle();

      await expect(
        service.update(id, { isPurchasable: true, priceCents }, creatorId)
      ).rejects.toMatchObject({
        statusCode: 422,
        context: { code: 'PRICE_REQUIRED' },
      });
    });

    it('saves an edit that leaves a live piece complete', async () => {
      const id = await liveArticle();

      const updated = await service.update(
        id,
        { title: 'Retitled' },
        creatorId
      );
      expect(updated.title).toBe('Retitled');
    });

    // A piece live before these rules may already miss one (the old update
    // rule only caught a flag and a price sent together). That gap doesn't
    // block an unrelated edit; a NEW gap still does.
    it('lets a live piece with an old gap take an edit, but not open another', async () => {
      const id = await liveArticle();
      await db
        .update(content)
        .set({ isPurchasable: true, priceCents: null })
        .where(eq(content.id, id));

      const retitled = await service.update(
        id,
        { title: 'Still unpriced' },
        creatorId
      );
      expect(retitled.title).toBe('Still unpriced');

      await expect(
        service.update(id, { contentBody: '' }, creatorId)
      ).rejects.toMatchObject({
        statusCode: 422,
        context: { code: 'BODY_REQUIRED' },
      });
    });

    it("refuses moving a live video onto media that isn't ready, naming its status", async () => {
      const [ready, transcoding] = await db
        .insert(mediaItems)
        .values([
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          }),
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'transcoding',
          }),
        ])
        .returning();
      if (!ready || !transcoding) throw new Error('failed to seed media');
      const draft = await service.create(
        {
          title: 'Live video, new cut',
          slug: createUniqueSlug('live-recut'),
          contentType: 'video',
          mediaItemId: ready.id,
          tags: [],
        },
        creatorId
      );
      await service.publish(draft.id, creatorId);

      await expect(
        service.update(draft.id, { mediaItemId: transcoding.id }, creatorId)
      ).rejects.toMatchObject({
        context: { code: 'MEDIA_NOT_READY', mediaStatus: 'transcoding' },
      });
    });

    it('saves a draft with no body and an unpriced sale', async () => {
      const draft = await service.create(
        {
          title: 'Draft',
          slug: createUniqueSlug('draft-incomplete'),
          contentType: 'written',
          contentBody: 'Words',
          tags: [],
        },
        creatorId
      );

      const updated = await service.update(
        draft.id,
        { contentBody: '', isPurchasable: true, priceCents: null },
        creatorId
      );
      expect(updated.status).toBe('draft');
    });
  });

  // Drafts autosave (Codex-a6ofh.2.2), so an update to a draft that was never
  // live must not stale catalogues it has never been in.
  describe('update bumps the catalogue only for a piece that has been live', () => {
    let watched: ContentService;
    const invalidate = vi.fn(async (_key: string) => undefined);

    beforeEach(() => {
      invalidate.mockClear();
      watched = new ContentService({ db, environment: 'test' });
      watched.setCache({ invalidate } as unknown as Parameters<
        ContentService['setCache']
      >[0]);
    });

    async function orgArticle(): Promise<{ id: string; orgId: string }> {
      const org = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      await joinTeam(db, org.id, creatorId);
      const draft = await watched.create(
        {
          title: 'Catalogue article',
          slug: createUniqueSlug('catalogue-article'),
          contentType: 'written',
          contentBody: 'Words',
          organizationId: org.id,
          tags: [],
        },
        creatorId
      );
      return { id: draft.id, orgId: org.id };
    }

    it('a draft that was never live bumps nothing', async () => {
      const { id } = await orgArticle();
      invalidate.mockClear();

      await watched.update(id, { title: 'Still a draft' }, creatorId);

      expect(invalidate).not.toHaveBeenCalled();
    });

    // Unpublishing keeps publishedAt: its buyers still have it. (A live
    // piece takes the same branch; hasBeenLive's own test, in
    // @codex/constants, covers the rule.)
    it('an unpublished piece bumps the published catalogue and its org', async () => {
      const { id, orgId } = await orgArticle();
      await watched.publish(id, creatorId);
      await watched.unpublish(id, creatorId);
      invalidate.mockClear();

      await watched.update(id, { title: 'Edited after going live' }, creatorId);

      expect(invalidate).toHaveBeenCalledWith(
        CacheType.COLLECTION_CONTENT_PUBLISHED
      );
      expect(invalidate).toHaveBeenCalledWith(
        CacheType.COLLECTION_ORG_CONTENT(orgId)
      );
    });

    // trigger_unpublish_on_org_delete (migration 0004) resets status and
    // publishedAt as the row leaves its org, so the row it returns reads as
    // a draft that was never live. Its buyers still hold it.
    it('a live piece moved out of its org still counts as live', async () => {
      const { id } = await orgArticle();
      await watched.publish(id, creatorId);
      invalidate.mockClear();

      const moved = await watched.updateReportingDroppedThumbnail(
        id,
        { organizationId: null },
        creatorId
      );

      expect(moved.content).toMatchObject({
        status: 'draft',
        publishedAt: null,
        organizationId: null,
      });
      expect(moved.hasBeenLive).toBe(true);
      expect(invalidate).toHaveBeenCalledWith(
        CacheType.COLLECTION_CONTENT_PUBLISHED
      );
    });
  });

  describe('publish — Stripe Connect payout gate (Codex-eb00a.10)', () => {
    // Each test controls its own Connect precondition; reset between tests so a
    // seeded ready-account from one test can't leak into the "no account" cases
    // (uq_stripe_connect_user makes double-inserts fail otherwise). Scoped to
    // this creator: the table is shared with every other suite on the branch.
    afterEach(async () => {
      await db
        .delete(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.userId, creatorId));
    });

    async function createPaidWritten(slugPrefix: string): Promise<string> {
      const created = await service.create(
        {
          title: 'Paid Article',
          slug: createUniqueSlug(slugPrefix),
          contentType: 'written',
          contentBody: 'Paid body',
          visibility: 'public',
          isPurchasable: true,
          priceCents: 500,
          tags: [],
        } as unknown as CreateContentInput,
        creatorId
      );
      return created.id;
    }

    it('blocks publishing PAID content when the creator has no Connect account', async () => {
      const id = await createPaidWritten('paid-no-connect');

      await expect(service.publish(id, creatorId)).rejects.toBeInstanceOf(
        CreatorPayoutsRequiredError
      );

      // Content must remain a draft — the block is a hard gate, not a warning.
      const stillDraft = await service.get(id, creatorId);
      expect(stillDraft?.status).toBe('draft');
    });

    it('blocks publishing PAID content when Connect exists but is not payout-ready', async () => {
      // Onboarding-in-progress account: charges/payouts still disabled.
      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(null, creatorId, {
          status: 'onboarding',
          chargesEnabled: false,
          payoutsEnabled: false,
          onboardingCompletedAt: null,
        })
      );
      const id = await createPaidWritten('paid-not-ready');

      await expect(service.publish(id, creatorId)).rejects.toBeInstanceOf(
        CreatorPayoutsRequiredError
      );
    });

    it('blocks when charges enabled but payouts disabled (mirrors backend requireActiveConnect)', async () => {
      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(null, creatorId, {
          status: 'restricted',
          chargesEnabled: true,
          payoutsEnabled: false,
        })
      );
      const id = await createPaidWritten('paid-payouts-off');

      await expect(service.publish(id, creatorId)).rejects.toBeInstanceOf(
        CreatorPayoutsRequiredError
      );
    });

    it('publishes PAID content when the creator Connect account is charges + payouts ready', async () => {
      // createTestConnectAccountInput defaults to a ready account
      // (status 'active', chargesEnabled + payoutsEnabled true).
      await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(null, creatorId));
      const id = await createPaidWritten('paid-ready');

      const published = await service.publish(id, creatorId);

      expect(published.status).toBe('published');
      expect(published.publishedAt).not.toBeNull();
    });

    it('blocks publishing SUBSCRIBER-gated content without a ready Connect account', async () => {
      // Subscriber content must be org-scoped; seed the draft row directly
      // (service.create rejects orgless tier-gated content).
      const org = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      // Publish checks the creator is on the team (Codex-a6ofh.2.1).
      await joinTeam(db, org.id, creatorId);
      const tier = takeFirst(
        await db
          .insert(subscriptionTiers)
          .values(createTestTierInput(org.id, { sortOrder: 1 }))
          .returning()
      );
      const seeded = takeFirst(
        await db
          .insert(content)
          .values({
            creatorId,
            organizationId: org.id,
            title: 'Subscriber Article',
            slug: createUniqueSlug('sub-no-connect'),
            contentType: 'written',
            contentBody: 'Members only',
            isFree: false,
            isTierGated: true,
            status: 'draft',
          })
          .returning()
      );
      await gateContentToTiers(db, {
        contentId: seeded.id,
        organizationId: org.id,
        tierIds: [tier.id],
      });

      await expect(
        service.publish(seeded.id, creatorId)
      ).rejects.toBeInstanceOf(CreatorPayoutsRequiredError);
    });

    it('does NOT gate FREE content — publishes with no Connect account at all', async () => {
      const created = await service.create(
        {
          title: 'Free Article',
          slug: createUniqueSlug('free-no-connect'),
          contentType: 'written',
          contentBody: 'Free body',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      const published = await service.publish(created.id, creatorId);

      expect(published.status).toBe('published');
    });
  });

  describe('payout gate covers any price or tier, on publish AND on update (Codex-2hxff.14)', () => {
    let orgId: string;
    let tierId: string;
    let otherTierId: string;
    const contentIds: string[] = [];

    beforeAll(async () => {
      orgId = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      ).id;
      // Publish checks the creator is on the team (Codex-a6ofh.2.1).
      await joinTeam(db, orgId, creatorId);
      tierId = takeFirst(
        await db
          .insert(subscriptionTiers)
          .values(createTestTierInput(orgId, { sortOrder: 1 }))
          .returning()
      ).id;
      otherTierId = takeFirst(
        await db
          .insert(subscriptionTiers)
          .values(createTestTierInput(orgId, { sortOrder: 2 }))
          .returning()
      ).id;
    });

    afterEach(async () => {
      await db
        .delete(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.userId, creatorId));
    });

    afterAll(async () => {
      if (contentIds.length > 0) {
        await db.delete(content).where(inArray(content.id, contentIds));
      }
      await db
        .delete(subscriptionTiers)
        .where(eq(subscriptionTiers.organizationId, orgId));
      await db.delete(organizations).where(eq(organizations.id, orgId));
    });

    /**
     * Seed an org row directly, so each test sets exactly the policy flags it
     * is about (and a LIVE row can exist without passing publish's gate, as
     * legacy rows published before it do).
     */
    async function seed(
      flags: Partial<typeof content.$inferInsert> & {
        /** Ticked tiers: turns the tier switch on. */
        tierIds?: string[];
      }
    ): Promise<string> {
      const { tierIds, ...policy } = flags;
      const row = takeFirst(
        await db
          .insert(content)
          .values({
            creatorId,
            organizationId: orgId,
            title: 'Gate Article',
            slug: createUniqueSlug('payout-gate'),
            contentType: 'written',
            contentBody: 'Body',
            status: 'draft',
            ...policy,
            isTierGated: tierIds !== undefined,
          })
          .returning()
      );
      contentIds.push(row.id);
      if (tierIds !== undefined) {
        await gateContentToTiers(db, {
          contentId: row.id,
          organizationId: orgId,
          tierIds,
        });
      }
      return row.id;
    }

    const live = { status: 'published', publishedAt: new Date() } as const;

    async function makeCreatorPayable(): Promise<void> {
      await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(null, creatorId));
    }

    describe('publish', () => {
      it('refuses PRICED content that is not marked purchasable', async () => {
        // The old gate saw a price only on a row marked purchasable.
        const id = await seed({
          isFree: false,
          isPurchasable: false,
          priceCents: 500,
        });

        await expect(service.publish(id, creatorId)).rejects.toBeInstanceOf(
          CreatorPayoutsRequiredError
        );
        expect((await service.get(id, creatorId))?.status).toBe('draft');
      });

      it('refuses TIER-only content (no price)', async () => {
        const id = await seed({ isFree: false, tierIds: [tierId] });

        await expect(service.publish(id, creatorId)).rejects.toBeInstanceOf(
          CreatorPayoutsRequiredError
        );
      });

      it('publishes priced-not-purchasable and tier-only content once the creator is payout-ready', async () => {
        await makeCreatorPayable();
        const priced = await seed({
          isFree: false,
          isPurchasable: false,
          priceCents: 500,
        });
        const tiered = await seed({ isFree: false, tierIds: [tierId] });

        expect((await service.publish(priced, creatorId)).status).toBe(
          'published'
        );
        expect((await service.publish(tiered, creatorId)).status).toBe(
          'published'
        );
      });
    });

    describe('update of published content', () => {
      it('refuses a price added to free content when the creator has no Connect account', async () => {
        const id = await seed({ ...live, isFree: true, priceCents: 0 });

        await expect(
          service.update(id, { priceCents: 900 }, creatorId)
        ).rejects.toBeInstanceOf(CreatorPayoutsRequiredError);

        // Rolled back with the transaction: the row is still free.
        expect((await service.get(id, creatorId))?.priceCents).toBe(0);
      });

      it('refuses a tier added to free content', async () => {
        const id = await seed({ ...live, isFree: true });

        await expect(
          service.update(id, { includedInTierId: tierId }, creatorId)
        ).rejects.toBeInstanceOf(CreatorPayoutsRequiredError);
        expect((await service.get(id, creatorId))?.includedInTierId).toBeNull();
      });

      it('refuses a changed price, a changed tier, and turning a priced row purchasable', async () => {
        const priced = await seed({
          ...live,
          isFree: false,
          isPurchasable: true,
          priceCents: 500,
        });
        const tiered = await seed({
          ...live,
          isFree: false,
          tierIds: [tierId],
        });
        const notPurchasable = await seed({
          ...live,
          isFree: false,
          isPurchasable: false,
          priceCents: 500,
        });

        await expect(
          service.update(priced, { priceCents: 700 }, creatorId)
        ).rejects.toBeInstanceOf(CreatorPayoutsRequiredError);
        await expect(
          service.update(tiered, { includedInTierId: otherTierId }, creatorId)
        ).rejects.toBeInstanceOf(CreatorPayoutsRequiredError);
        await expect(
          service.update(notPurchasable, { isPurchasable: true }, creatorId)
        ).rejects.toBeInstanceOf(CreatorPayoutsRequiredError);
      });

      it('allows a title edit with a not-ready creator, even when the form resends the unchanged price and tier', async () => {
        const id = await seed({
          ...live,
          isFree: false,
          isPurchasable: true,
          priceCents: 500,
          tierIds: [tierId],
        });

        // The studio form submits the whole flag set on every save.
        const updated = await service.update(
          id,
          {
            title: 'Renamed Article',
            isFree: false,
            isPurchasable: true,
            priceCents: 500,
            includedInTierId: tierId,
          },
          creatorId
        );

        expect(updated.title).toBe('Renamed Article');
      });

      it('allows removing the price and the tier with a not-ready creator', async () => {
        const id = await seed({
          ...live,
          isFree: false,
          isPurchasable: true,
          priceCents: 500,
          tierIds: [tierId],
        });

        const updated = await service.update(
          id,
          {
            isFree: true,
            isPurchasable: false,
            priceCents: 0,
            includedInTierId: null,
          },
          creatorId
        );

        expect(updated.priceCents).toBe(0);
        expect(updated.includedInTierId).toBeNull();
      });

      it('does not check a DRAFT — publish() does', async () => {
        const id = await seed({ isFree: true, priceCents: 0 });

        const updated = await service.update(
          id,
          { priceCents: 900 },
          creatorId
        );

        expect(updated.priceCents).toBe(900);
      });

      it('allows a price and a tier added once the creator is payout-ready', async () => {
        await makeCreatorPayable();
        const id = await seed({ ...live, isFree: true, priceCents: 0 });

        const updated = await service.update(
          id,
          { priceCents: 900, includedInTierId: tierId },
          creatorId
        );

        expect(updated.priceCents).toBe(900);
        expect(updated.includedInTierId).toBe(tierId);
      });
    });
  });

  describe('unpublish', () => {
    it('should unpublish published content', async () => {
      // Arrange: Create and publish
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const created = await service.create(
        {
          title: 'Content',
          slug: createUniqueSlug('unpublish'),
          contentType: 'video',
          mediaItemId: media.id,
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
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const created = await service.create(
        {
          title: 'To Delete',
          slug: createUniqueSlug('delete'),
          contentType: 'video',
          mediaItemId: media.id,
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
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(otherCreatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const created = await service.create(
        {
          title: 'Other Content',
          slug: createUniqueSlug('other'),
          contentType: 'video',
          mediaItemId: media.id,
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
    let createdContentIds: string[] = [];

    beforeEach(async () => {
      // Reset the array for each test
      createdContentIds = [];

      // Create test content for list tests
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      // Create 5 content items and track their IDs
      for (let i = 0; i < 5; i++) {
        const created = await service.create(
          {
            title: `Content ${i}`,
            slug: createUniqueSlug(`list-${i}`),
            contentType: 'video',
            mediaItemId: media.id,
            priceCents: 0,
            tags: [],
          },
          creatorId
        );
        createdContentIds.push(created.id);
      }
    });

    it('should list all content for creator', async () => {
      // Act
      const result = await service.list(creatorId);

      // Assert: Verify we have at least the content we created
      expect(result.items.length).toBeGreaterThanOrEqual(5);
      expect(result.pagination.total).toBeGreaterThanOrEqual(5);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);

      // Verify our created content items are in the list
      for (const contentId of createdContentIds) {
        expect(result.items.some((item) => item.id === contentId)).toBe(true);
      }
    });

    it('should paginate content list', async () => {
      // Act: Get page 1 with limit 2
      const page1 = await service.list(creatorId, {}, { page: 1, limit: 2 });

      // Assert page 1
      expect(page1.items).toHaveLength(2);
      expect(page1.pagination.page).toBe(1);
      expect(page1.pagination.limit).toBe(2);
      expect(page1.pagination.total).toBeGreaterThanOrEqual(5);
      expect(page1.pagination.totalPages).toBeGreaterThanOrEqual(3);

      // Act: Get page 2
      const page2 = await service.list(creatorId, {}, { page: 2, limit: 2 });

      // Assert page 2
      expect(page2.items).toHaveLength(2);
      expect(page2.pagination.page).toBe(2);

      // Assert different items
      expect(page1.items[0]!.id).not.toBe(page2.items[0]!.id);
    });

    it('should filter by status', async () => {
      // Arrange: Publish one of our created content items
      const contentToPublish = createdContentIds[0]!;
      await service.publish(contentToPublish, creatorId);

      // Act: Filter by published
      const published = await service.list(creatorId, { status: 'published' });

      // Assert: Verify the published item is in the results
      expect(published.items.length).toBeGreaterThanOrEqual(1);
      expect(published.items.some((item) => item.id === contentToPublish)).toBe(
        true
      );
      published.items.forEach((item) => {
        expect(item.status).toBe('published');
      });

      // Act: Filter by draft
      const drafts = await service.list(creatorId, { status: 'draft' });

      // Assert: Verify our unpublished items are in drafts
      const unpublishedIds = createdContentIds.slice(1);
      expect(drafts.items.length).toBeGreaterThanOrEqual(4);
      for (const draftId of unpublishedIds) {
        expect(drafts.items.some((item) => item.id === draftId)).toBe(true);
      }
      drafts.items.forEach((item) => {
        expect(item.status).toBe('draft');
      });
    });

    it('should filter by content type', async () => {
      // Act
      const videos = await service.list(creatorId, { contentType: 'video' });

      // Assert: All our created content is video
      expect(videos.items.length).toBeGreaterThanOrEqual(5);
      for (const contentId of createdContentIds) {
        expect(videos.items.some((item) => item.id === contentId)).toBe(true);
      }
      videos.items.forEach((item) => {
        expect(item.contentType).toBe('video');
      });
    });

    it('should filter by accessType', async () => {
      // Act
      const freeContent = await service.list(creatorId, {
        accessType: 'free',
      });

      // Assert: All our created content is free (default)
      expect(freeContent.items.length).toBeGreaterThanOrEqual(5);
      for (const contentId of createdContentIds) {
        expect(freeContent.items.some((item) => item.id === contentId)).toBe(
          true
        );
      }
      freeContent.items.forEach((item) => {
        expect(item.isFree).toBe(true);
      });
    });

    it('should not return other creator content', async () => {
      // Arrange: Create content for other creator
      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(otherCreatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      await service.create(
        {
          title: 'Other Content',
          slug: createUniqueSlug('other'),
          contentType: 'video',
          mediaItemId: media.id,
          priceCents: 0,
          tags: [],
        },
        otherCreatorId
      );

      // Act
      const result = await service.list(creatorId);

      // Assert: Should have our content and only see own content
      expect(result.items.length).toBeGreaterThanOrEqual(5);
      for (const contentId of createdContentIds) {
        expect(result.items.some((item) => item.id === contentId)).toBe(true);
      }
      result.items.forEach((item) => {
        expect(item.creatorId).toBe(creatorId);
      });
    });

    it('should not return soft-deleted content', async () => {
      // Arrange: Delete one of our created content items
      const contentToDelete = createdContentIds[0]!;
      await service.delete(contentToDelete, creatorId);

      // Act
      const result = await service.list(creatorId);

      // Assert: The deleted item should not be in the results
      expect(result.items.some((item) => item.id === contentToDelete)).toBe(
        false
      );

      // The remaining items we created should still be there
      const remainingIds = createdContentIds.slice(1);
      for (const contentId of remainingIds) {
        expect(result.items.some((item) => item.id === contentId)).toBe(true);
      }
    });
  });

  describe('listPublic', () => {
    // Regression guard for the followers-only content body leak: listPublic
    // is a public, KV-cached endpoint, so any gated content's body text
    // (contentBody / contentBodyJson) MUST be stripped before returning.
    // A catalogue read (no slug) strips every body: cards read metadata, and
    // search filters in SQL. Only the detail page's by-slug read of a free
    // piece keeps it, which is what a crawler indexes (Codex-osuqt).
    it('strips every body from a catalogue read and keeps a free one by slug', async () => {
      // Arrange: follower-gated content requires an organizationId, so we
      // need an org before creating the gated article.
      const org = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      await joinTeam(db, org.id, creatorId);

      const freeArticle = await service.create(
        {
          title: 'Free Article',
          slug: createUniqueSlug('free-article'),
          contentType: 'written',
          priceCents: 0,
          tags: [],
          contentBody: 'This is the freely readable article body.',
        },
        creatorId
      );
      await service.publish(freeArticle.id, creatorId);

      const followersArticle = await service.create(
        {
          title: 'Followers Only Article',
          slug: createUniqueSlug('followers-article'),
          contentType: 'written',
          isFollowerGated: true,
          organizationId: org.id,
          priceCents: 0,
          tags: [],
          contentBody: 'SECRET body text that non-followers must not receive.',
        },
        creatorId
      );
      await service.publish(followersArticle.id, creatorId);

      // Act: call the public listing (no user context — as if a random
      // visitor were hitting /api/content/public).
      const result = await service.listPublic({
        page: 1,
        limit: 20,
        sort: 'newest',
      });

      const free = result.items.find((i) => i.id === freeArticle.id);
      const followers = result.items.find((i) => i.id === followersArticle.id);

      // Both are listed (metadata is public), and neither carries a body.
      expect(free).toBeDefined();
      expect(free?.contentBody).toBeNull();
      expect(followers).toBeDefined();
      expect(followers?.title).toBe('Followers Only Article');
      expect(followers?.isFollowerGated).toBe(true);
      expect(followers?.contentBody).toBeNull();
      expect(followers?.contentBodyJson).toBeNull();

      const bySlug = async (slug: string) =>
        (
          await service.listPublic({
            creatorId,
            slug,
            page: 1,
            limit: 20,
            sort: 'newest',
          })
        ).items[0];

      // The detail page's read: a free article exposes its body, a gated
      // one still does not.
      expect((await bySlug(freeArticle.slug))?.contentBody).toBe(
        'This is the freely readable article body.'
      );
      const followersBySlug = await bySlug(followersArticle.slug);
      expect(followersBySlug?.id).toBe(followersArticle.id);
      expect(followersBySlug?.contentBody).toBeNull();
    });
  });
});
