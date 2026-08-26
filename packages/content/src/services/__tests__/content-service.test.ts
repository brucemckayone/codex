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
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import type { CreateContentInput } from '@codex/validation';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
        expect(result.isFree).toBe(true);
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

      it('rejects orgless content with a minimumTierId set (Codex-up7bx)', async () => {
        // subscription_tiers is org-scoped, so a tier on orgless content is
        // a semantically invalid row. The write schema rejects it at create().
        const [media] = await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning();

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

      it('clears a lingering tier when content is updated to be orgless (Codex-up7bx)', async () => {
        // Seed org-scoped subscriber content WITH a real tier, then move it
        // out of the org via update. The service must clamp the now-dangling
        // tier to null so the access layer never has to fail closed on it.
        const [org] = await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning();

        const [tier] = await db
          .insert(subscriptionTiers)
          .values(createTestTierInput(org.id, { sortOrder: 1 }))
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

        // Insert a valid org-scoped tier-gated row directly (bypasses the
        // create schema, mirroring how legitimate subscriber content lands).
        const [seeded] = await db
          .insert(content)
          .values({
            creatorId,
            organizationId: org.id,
            mediaItemId: media.id,
            title: 'Org Tier Content',
            slug: createUniqueSlug('org-tier'),
            contentType: 'video',
            isFree: false,
            includedInTierId: tier.id,
            status: 'draft',
          })
          .returning();

        // Update to orgless WITHOUT touching minimumTierId in the payload —
        // the schema can't reason here; the service clamp must clear the tier.
        const updated = await service.update(
          seeded.id,
          { organizationId: null },
          creatorId
        );

        expect(updated.organizationId).toBeNull();
        expect(updated.includedInTierId).toBeNull();
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

      it('should create paid content with paid access type', async () => {
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

    it('should update content access type and price', async () => {
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
        includedInTierId?: string | null;
        organizationId?: string | null;
      }): Promise<string> {
        const [media] = await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning();
        const [row] = await db
          .insert(content)
          .values({
            creatorId,
            mediaItemId: media.id,
            title: 'Gated Content',
            slug: createUniqueSlug('gated'),
            contentType: 'video',
            isFree: false,
            status: 'draft',
            ...flags,
          })
          .returning();
        return row.id;
      }

      it('clearing a subscriber tier makes the row FREE, not a zero-gate public row', async () => {
        const [org] = await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning();
        const [tier] = await db
          .insert(subscriptionTiers)
          .values(createTestTierInput(org.id, { sortOrder: 1 }))
          .returning();
        const id = await seedGated({
          organizationId: org.id,
          includedInTierId: tier.id,
        });

        // Partial PATCH clears the sole gate WITHOUT restating isFree.
        const updated = await service.update(
          id,
          { includedInTierId: null },
          creatorId
        );

        expect(updated.includedInTierId).toBeNull();
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
        const [org] = await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning();
        const [tier] = await db
          .insert(subscriptionTiers)
          .values(createTestTierInput(org.id, { sortOrder: 1 }))
          .returning();
        const id = await seedGated({
          organizationId: org.id,
          isPurchasable: true,
          priceCents: 1500,
          includedInTierId: tier.id,
        });

        const updated = await service.update(
          id,
          { isPurchasable: false, priceCents: null },
          creatorId
        );

        expect(updated.isPurchasable).toBe(false);
        expect(updated.includedInTierId).toBe(tier.id); // tier gate remains
        expect(updated.isFree).toBe(false); // still gated → NOT clamped free
      });
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

  describe('publish — Stripe Connect payout gate (Codex-eb00a.10)', () => {
    // Each test controls its own Connect precondition; reset between tests so a
    // seeded ready-account from one test can't leak into the "no account" cases
    // (uq_stripe_connect_user makes double-inserts fail otherwise).
    afterEach(async () => {
      await db.delete(stripeConnectAccounts);
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
      expect(stillDraft.status).toBe('draft');
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
      const [org] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();
      const [tier] = await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(org.id, { sortOrder: 1 }))
        .returning();
      const [seeded] = await db
        .insert(content)
        .values({
          creatorId,
          organizationId: org.id,
          title: 'Subscriber Article',
          slug: createUniqueSlug('sub-no-connect'),
          contentType: 'written',
          contentBody: 'Members only',
          isFree: false,
          includedInTierId: tier.id,
          status: 'draft',
        })
        .returning();

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
          visibility: 'public',
          priceCents: 0,
          tags: [],
        },
        creatorId
      );

      const published = await service.publish(created.id, creatorId);

      expect(published.status).toBe('published');
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
    let createdContentIds: string[] = [];

    beforeEach(async () => {
      // Reset the array for each test
      createdContentIds = [];

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

      // Create 5 content items and track their IDs
      for (let i = 0; i < 5; i++) {
        const created = await service.create(
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
      expect(page1.items[0].id).not.toBe(page2.items[0].id);
    });

    it('should filter by status', async () => {
      // Arrange: Publish one of our created content items
      const contentToPublish = createdContentIds[0];
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
      const contentToDelete = createdContentIds[0];
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
    // Free content keeps its body so search / SEO still index the article.
    it('strips body columns from non-free content and preserves them for free', async () => {
      // Arrange: follower-gated content requires an organizationId, so we
      // need an org before creating the gated article.
      const [org] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const freeArticle = await service.create(
        {
          title: 'Free Article',
          slug: createUniqueSlug('free-article'),
          contentType: 'written',
          visibility: 'public',
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
          visibility: 'public',
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

      // Free article exposes its body.
      expect(free).toBeDefined();
      expect(free?.contentBody).toBe(
        'This is the freely readable article body.'
      );

      // Followers-only article is listed (metadata is public) but body
      // columns are nulled before leaving the service boundary.
      expect(followers).toBeDefined();
      expect(followers?.title).toBe('Followers Only Article');
      expect(followers?.isFollowerGated).toBe(true);
      expect(followers?.contentBody).toBeNull();
      expect(followers?.contentBodyJson).toBeNull();
    });
  });
});
