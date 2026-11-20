/**
 * Admin Content Management Service Tests
 *
 * Comprehensive test suite for AdminContentManagementService covering:
 * - List all content with pagination and filtering
 * - Publish content (admin override)
 * - Unpublish content (admin override)
 * - Delete content (the creator's path: a held piece leaves with notice)
 * - Takedown (a platform admin's immediate delete)
 * - Organization scoping enforcement
 * - Error handling
 *
 * Database Isolation:
 * - Uses neon-testing for ephemeral branch per test file
 * - Each test creates its own data (idempotent tests)
 */

import { randomUUID } from 'node:crypto';
import { CONTENT_STATUS, PAGINATION } from '@codex/constants';
import {
  ContentService,
  CreatorPayoutsRequiredError,
  TierRequiredToPublishError,
} from '@codex/content';
import {
  contentLeavingNotices,
  content as contentTable,
  mediaItems,
  organizations,
  purchases,
  stripeConnectAccounts,
  subscriptionTiers,
} from '@codex/database/schema';
import { BusinessLogicError, NotFoundError } from '@codex/service-errors';
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
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AdminContentManagementService } from '../services/content-management-service';

describe('AdminContentManagementService', () => {
  let db: Database;
  let service: AdminContentManagementService;
  /** The creator's own delete and Keep, the side the org's are not. */
  let creatorSide: ContentService;
  let creatorId: string;
  let orgId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new AdminContentManagementService({ db, environment: 'test' });
    creatorSide = new ContentService({ db, environment: 'test' });

    // Create test user
    const userIds = await seedTestUsers(db, 1);
    [creatorId] = userIds;

    // Create organization
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning()
    );
    orgId = org.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('listAllContent', () => {
    it('should return empty list for organization with no content', async () => {
      const emptyOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );

      const result = await service.listAllContent(emptyOrg.id);

      expect(result.items).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(PAGINATION.DEFAULT);
    });

    it('should list all non-deleted content for organization', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
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

      // Create multiple content items
      for (let i = 0; i < 5; i++) {
        await db.insert(contentTable).values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: `Content ${i}`,
          slug: createUniqueSlug(`list-test-${i}`),
          contentType: 'video',
          status: i % 2 === 0 ? CONTENT_STATUS.DRAFT : CONTENT_STATUS.PUBLISHED,
          priceCents: 0,
        });
      }

      const result = await service.listAllContent(testOrg.id);

      expect(result.items.length).toBeGreaterThanOrEqual(5);
      expect(result.pagination.total).toBeGreaterThanOrEqual(5);
    });

    it('should paginate content correctly', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
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

      // Create 10 content items
      for (let i = 0; i < 10; i++) {
        await db.insert(contentTable).values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: `Paginated Content ${i}`,
          slug: createUniqueSlug(`paginate-${i}`),
          contentType: 'video',
          status: CONTENT_STATUS.DRAFT,
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
      expect(page1.items[0]!.id).not.toBe(page2.items[0]!.id);
    });

    it('should filter by status', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
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

      // Create draft and published content
      await db.insert(contentTable).values([
        {
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Draft Content',
          slug: createUniqueSlug('draft-filter'),
          contentType: 'video',
          status: CONTENT_STATUS.DRAFT,
          priceCents: 0,
        },
        {
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Published Content',
          slug: createUniqueSlug('published-filter'),
          contentType: 'video',
          status: CONTENT_STATUS.PUBLISHED,
          publishedAt: new Date(),
          priceCents: 0,
        },
      ]);

      const draftResult = await service.listAllContent(testOrg.id, {
        status: CONTENT_STATUS.DRAFT,
      });
      const publishedResult = await service.listAllContent(testOrg.id, {
        status: CONTENT_STATUS.PUBLISHED,
      });

      expect(
        draftResult.items.every((c) => c.status === CONTENT_STATUS.DRAFT)
      ).toBe(true);
      expect(
        publishedResult.items.every(
          (c) => c.status === CONTENT_STATUS.PUBLISHED
        )
      ).toBe(true);
    });

    it('should exclude soft-deleted content', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
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

      // Create one normal and one deleted content
      const normalContent = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'Normal Content',
            slug: createUniqueSlug('normal'),
            contentType: 'video',
            status: CONTENT_STATUS.DRAFT,
            priceCents: 0,
          })
          .returning()
      );

      const deletedContent = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'Deleted Content',
            slug: createUniqueSlug('deleted'),
            contentType: 'video',
            status: CONTENT_STATUS.DRAFT,
            priceCents: 0,
            deletedAt: new Date(),
          })
          .returning()
      );

      const result = await service.listAllContent(testOrg.id);

      const ids = result.items.map((c) => c.id);
      expect(ids).toContain(normalContent.id);
      expect(ids).not.toContain(deletedContent.id);
    });

    // Note: Organization existence validation is handled by middleware (requirePlatformOwner)
    // Service trusts that organizationId is valid when passed from authenticated context
  });

  describe('publishContent', () => {
    /**
     * An org with the creator on its team: an admin publish checks the
     * creator still is, as the creator's own publish does (Codex-a6ofh.2.1).
     */
    async function seedTeamOrg() {
      const org = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      await joinTeam(db, org.id, creatorId);
      return org;
    }

    it('should publish draft content', async () => {
      const testOrg = await seedTeamOrg();

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

      const draft = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'Draft to Publish',
            slug: createUniqueSlug('publish-test'),
            contentType: 'video',
            status: CONTENT_STATUS.DRAFT,
            priceCents: 0,
          })
          .returning()
      );

      const published = await service.publishContent(testOrg.id, draft.id);

      expect(published.status).toBe(CONTENT_STATUS.PUBLISHED);
      expect(published.publishedAt).not.toBeNull();
    });

    it('should be idempotent (publishing already published content)', async () => {
      const testOrg = await seedTeamOrg();

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

      const content = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'Already Published',
            slug: createUniqueSlug('idempotent-publish'),
            contentType: 'video',
            status: CONTENT_STATUS.PUBLISHED,
            publishedAt: new Date(),
            priceCents: 0,
          })
          .returning()
      );

      const result = await service.publishContent(testOrg.id, content.id);

      expect(result.status).toBe(CONTENT_STATUS.PUBLISHED);
    });

    it('should throw BusinessLogicError for video content without ready media', async () => {
      const testOrg = await seedTeamOrg();

      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'transcoding', // Not ready
            })
          )
          .returning()
      );

      const content = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'Not Ready Content',
            slug: createUniqueSlug('not-ready'),
            contentType: 'video',
            status: CONTENT_STATUS.DRAFT,
            priceCents: 0,
          })
          .returning()
      );

      await expect(
        service.publishContent(testOrg.id, content.id)
      ).rejects.toThrow(BusinessLogicError);
    });

    it('should publish written content without media', async () => {
      const testOrg = await seedTeamOrg();

      const content = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            title: 'Written Content',
            slug: createUniqueSlug('written-publish'),
            contentType: 'written',
            contentBody: 'This is written content',
            status: CONTENT_STATUS.DRAFT,
            priceCents: 0,
          })
          .returning()
      );

      const published = await service.publishContent(testOrg.id, content.id);

      expect(published.status).toBe(CONTENT_STATUS.PUBLISHED);
    });

    it('republishing an item taken off sale on a departure clears the stamp (Codex-2hxff.64)', async () => {
      const testOrg = await seedTeamOrg();
      // What a removal leaves (withdrawCatalogueOnDeparture).
      const content = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            title: 'Taken off sale',
            slug: createUniqueSlug('off-sale-republish'),
            contentType: 'written',
            contentBody: 'Body',
            status: CONTENT_STATUS.ARCHIVED,
            publishedAt: new Date(),
            offSaleAt: new Date(),
            priceCents: 0,
          })
          .returning()
      );

      const published = await service.publishContent(testOrg.id, content.id);

      // Without the clear, tier access would still end at the next renewal.
      expect(published.status).toBe(CONTENT_STATUS.PUBLISHED);
      expect(published.offSaleAt).toBeNull();
    });

    it('should throw NotFoundError for content from different organization', async () => {
      const org1 = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      const org2 = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
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

      const content = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: org1.id,
            mediaItemId: media.id,
            title: 'Org1 Content',
            slug: createUniqueSlug('cross-org'),
            contentType: 'video',
            status: CONTENT_STATUS.DRAFT,
            priceCents: 0,
          })
          .returning()
      );

      // Try to publish content from org1 using org2
      await expect(service.publishContent(org2.id, content.id)).rejects.toThrow(
        NotFoundError
      );
    });

    describe('payout gate — an admin publish is held to the creator rule (Codex-2hxff.14)', () => {
      let gateOrgId: string;
      let tierId: string;
      const contentIds: string[] = [];

      beforeAll(async () => {
        gateOrgId = takeFirst(
          await db
            .insert(organizations)
            .values(createTestOrganizationInput())
            .returning()
        ).id;
        await joinTeam(db, gateOrgId, creatorId);
        tierId = takeFirst(
          await db
            .insert(subscriptionTiers)
            .values(createTestTierInput(gateOrgId, { sortOrder: 1 }))
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
          await db
            .delete(contentTable)
            .where(inArray(contentTable.id, contentIds));
        }
        await db
          .delete(subscriptionTiers)
          .where(eq(subscriptionTiers.organizationId, gateOrgId));
        await db.delete(organizations).where(eq(organizations.id, gateOrgId));
      });

      async function seedDraft(
        flags: Partial<typeof contentTable.$inferInsert> & {
          /** Behind the tier switch, ticked on these tiers. */
          tierIds?: string[];
        }
      ): Promise<string> {
        const { tierIds, ...policy } = flags;
        const row = takeFirst(
          await db
            .insert(contentTable)
            .values({
              creatorId,
              organizationId: gateOrgId,
              title: 'Gated Draft',
              slug: createUniqueSlug('admin-payout-gate'),
              contentType: 'written',
              contentBody: 'Body',
              status: CONTENT_STATUS.DRAFT,
              ...policy,
              isTierGated: tierIds !== undefined,
            })
            .returning()
        );
        contentIds.push(row.id);
        if (tierIds !== undefined) {
          await gateContentToTiers(db, {
            contentId: row.id,
            organizationId: gateOrgId,
            tierIds,
          });
        }
        return row.id;
      }

      it('refuses priced content (purchasable or not) when the creator has no Connect account', async () => {
        const purchasable = await seedDraft({
          isFree: false,
          isPurchasable: true,
          priceCents: 900,
        });
        const notPurchasable = await seedDraft({
          isFree: false,
          isPurchasable: false,
          priceCents: 900,
        });

        await expect(
          service.publishContent(gateOrgId, purchasable)
        ).rejects.toBeInstanceOf(CreatorPayoutsRequiredError);
        await expect(
          service.publishContent(gateOrgId, notPurchasable)
        ).rejects.toBeInstanceOf(CreatorPayoutsRequiredError);

        const [row] = await db
          .select({ status: contentTable.status })
          .from(contentTable)
          .where(eq(contentTable.id, purchasable));
        expect(row?.status).toBe(CONTENT_STATUS.DRAFT);
      });

      it('refuses tier-only content, and a Connect account with payouts still disabled', async () => {
        await db.insert(stripeConnectAccounts).values(
          createTestConnectAccountInput(null, creatorId, {
            status: 'restricted',
            chargesEnabled: true,
            payoutsEnabled: false,
          })
        );
        const tiered = await seedDraft({
          isFree: false,
          tierIds: [tierId],
        });

        const refusal = service.publishContent(gateOrgId, tiered);
        await expect(refusal).rejects.toBeInstanceOf(
          CreatorPayoutsRequiredError
        );
        // The Studio recognises the condition by this code, whichever route
        // refused (both run the one publish gate, Codex-a6ofh.2.1).
        await expect(refusal).rejects.toMatchObject({
          context: expect.objectContaining({
            code: 'CREATOR_CONNECT_REQUIRED',
          }),
        });
      });

      it('publishes priced and tier content once the creator is payout-ready, and free content without an account', async () => {
        const free = await seedDraft({ isFree: true, priceCents: 0 });
        expect((await service.publishContent(gateOrgId, free)).status).toBe(
          CONTENT_STATUS.PUBLISHED
        );

        await db
          .insert(stripeConnectAccounts)
          .values(createTestConnectAccountInput(null, creatorId));
        const priced = await seedDraft({
          isFree: false,
          isPurchasable: false,
          priceCents: 900,
        });
        const tiered = await seedDraft({
          isFree: false,
          tierIds: [tierId],
        });

        expect((await service.publishContent(gateOrgId, priced)).status).toBe(
          CONTENT_STATUS.PUBLISHED
        );
        expect((await service.publishContent(gateOrgId, tiered)).status).toBe(
          CONTENT_STATUS.PUBLISHED
        );
      });

      // Owner U2 (Codex-2hxff.91): the same rule as ContentService.publish.
      it('refuses subscriber content with no tier ticked, and publishes a PAID one', async () => {
        await db
          .insert(stripeConnectAccounts)
          .values(createTestConnectAccountInput(null, creatorId));
        const closed = await seedDraft({ isFree: false, tierIds: [] });
        const paidClosed = await seedDraft({
          isFree: false,
          isPurchasable: true,
          priceCents: 900,
          tierIds: [],
        });

        const refusal = await service
          .publishContent(gateOrgId, closed)
          .catch((e: unknown) => e);
        expect(refusal).toBeInstanceOf(TierRequiredToPublishError);
        expect((refusal as TierRequiredToPublishError).context).toEqual({
          contentId: closed,
          code: 'TIER_REQUIRED_TO_PUBLISH',
        });
        expect(
          (await service.publishContent(gateOrgId, paidClosed)).status
        ).toBe(CONTENT_STATUS.PUBLISHED);
      });
    });
  });

  describe('unpublishContent', () => {
    it('should unpublish published content', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
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

      const content = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'Published Content',
            slug: createUniqueSlug('unpublish-test'),
            contentType: 'video',
            status: CONTENT_STATUS.PUBLISHED,
            publishedAt: new Date(),
            priceCents: 0,
          })
          .returning()
      );

      const unpublished = await service.unpublishContent(
        testOrg.id,
        content.id
      );

      expect(unpublished.status).toBe(CONTENT_STATUS.DRAFT);
    });

    it('should be idempotent (unpublishing already draft content)', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
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

      const content = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'Already Draft',
            slug: createUniqueSlug('idempotent-unpublish'),
            contentType: 'video',
            status: CONTENT_STATUS.DRAFT,
            priceCents: 0,
          })
          .returning()
      );

      const result = await service.unpublishContent(testOrg.id, content.id);

      expect(result.status).toBe(CONTENT_STATUS.DRAFT);
    });

    it('should throw NotFoundError for non-existent content', async () => {
      await expect(
        service.unpublishContent(orgId, '00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteContent', () => {
    it('should soft delete content', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
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

      const content = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'To Delete',
            slug: createUniqueSlug('delete-test'),
            contentType: 'video',
            status: CONTENT_STATUS.DRAFT,
            priceCents: 0,
          })
          .returning()
      );

      const result = await service.deleteContent(testOrg.id, content.id);

      expect(result).toEqual({
        outcome: 'deleted',
        leavesAt: null,
        holders: 0,
        creatorId,
      });

      // Verify content is no longer returned in list
      const list = await service.listAllContent(testOrg.id);
      expect(list.items.find((c) => c.id === content.id)).toBeUndefined();
    });

    it('should throw NotFoundError for content from different organization', async () => {
      const org1 = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      const org2 = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
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

      const content = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: org1.id,
            mediaItemId: media.id,
            title: 'Cross Org Delete',
            slug: createUniqueSlug('cross-org-delete'),
            contentType: 'video',
            status: CONTENT_STATUS.DRAFT,
            priceCents: 0,
          })
          .returning()
      );

      // Try to delete content from org1 using org2
      await expect(service.deleteContent(org2.id, content.id)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw NotFoundError for already deleted content', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
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

      const content = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'Already Deleted',
            slug: createUniqueSlug('already-deleted'),
            contentType: 'video',
            status: CONTENT_STATUS.DRAFT,
            priceCents: 0,
            deletedAt: new Date(),
          })
          .returning()
      );

      await expect(
        service.deleteContent(testOrg.id, content.id)
      ).rejects.toThrow(NotFoundError);
    });

    it('gives a held piece notice, as the creator’s delete does', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const piece = await livePiece();
      await bought(piece.id, buyer);

      const result = await service.deleteContent(orgId, piece.id);

      expect(result).toMatchObject({
        outcome: 'leaving',
        holders: 1,
        creatorId,
      });
      const after = await stored(piece.id);
      expect(after.deletedAt).toBeNull();
      expect(after.leavesAt?.getTime()).toBe(result.leavesAt?.getTime());
      // The org's delete (owner 2026-11-19): only an org admin withdraws it.
      expect([after.leavingByCreator, after.leavingByOrg]).toEqual([
        false,
        true,
      ]);
      expect(
        (await noticesOf(piece.id)).map((n) => [n.userId, n.kind])
      ).toEqual([[buyer, 'leaving']]);
    });

    // Owner, review round 2: the gap runs from a period that emailed
    // someone, so the creator's silent delete and Keep cannot hold this off.
    it('is not held off by the creator’s delete and Keep that emailed nobody', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const piece = await livePiece();
      await bought(piece.id, buyer);
      await creatorSide.delete(piece.id, creatorId);
      await creatorSide.keep(piece.id, creatorId);

      const result = await service.deleteContent(orgId, piece.id);

      expect(result.outcome).toBe('leaving');
      expect((await stored(piece.id)).leavingByOrg).toBe(true);
    });

    // Owner, review round 3: a delete of a piece already leaving adds its
    // side to the leave, never takes the leave over.
    it('adds the org’s side to a leave its creator started, with no new round or email', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const piece = await livePiece();
      await bought(piece.id, buyer);
      const { result: first } = await creatorSide.delete(piece.id, creatorId);

      const again = await service.deleteContent(orgId, piece.id);

      expect(again).toMatchObject({
        outcome: 'leaving',
        leavesAt: first.leavesAt,
        holders: 1,
      });
      const after = await stored(piece.id);
      expect([after.leavingByCreator, after.leavingByOrg]).toEqual([
        true,
        true,
      ]);
      expect(await noticesOf(piece.id)).toHaveLength(1);
      // The creator's Keep withdraws only the creator's delete: it still
      // leaves, and only the org's Keep then keeps it.
      const { result: mine } = await creatorSide.keep(piece.id, creatorId);
      expect(mine).toEqual({ kept: false, staying: 0, stillLeavingBy: 'org' });
      expect((await stored(piece.id)).leavesAt).not.toBeNull();
      expect(await service.keepContent(orgId, piece.id)).toMatchObject({
        kept: true,
      });
    });

    // Review round 3's attack: the org takes over the creator's leave, keeps
    // it and publishes it, undoing the creator's delete in three calls.
    it('cannot undo the creator’s delete: delete, keep, publish leaves it leaving', async () => {
      const teamOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      // Its creator on the team, so the leave is what refuses the publish.
      await joinTeam(db, teamOrg.id, creatorId);
      const [buyer] = await seedTestUsers(db, 1);
      const piece = await livePiece(teamOrg.id);
      await bought(piece.id, buyer);
      await creatorSide.delete(piece.id, creatorId);
      await service.deleteContent(teamOrg.id, piece.id);

      const kept = await service.keepContent(teamOrg.id, piece.id);

      expect(kept).toEqual({
        kept: false,
        staying: 0,
        stillLeavingBy: 'creator',
      });
      expect((await stored(piece.id)).leavesAt).not.toBeNull();
      await expect(
        service.publishContent(teamOrg.id, piece.id)
      ).rejects.toMatchObject({
        statusCode: 409,
        context: { code: 'CONTENT_LEAVING' },
      });
    });
  });

  // ── the leaving notice (Codex-a6ofh.6) ────────────────────────────────────

  /** The 403 a Keep by the side that did not start the leave answers. */
  const notYours = (startedBy: 'org' | 'creator') => ({
    statusCode: 403,
    context: { code: 'CONTENT_LEAVE_NOT_YOURS', startedBy },
  });

  /** A live free article in the org (the suite's unless told). */
  async function livePiece(organizationId = orgId) {
    return takeFirst(
      await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId,
          title: 'Leaving notice',
          slug: createUniqueSlug('leaving'),
          contentType: 'written',
          contentBody: 'Something to read',
          status: CONTENT_STATUS.PUBLISHED,
          publishedAt: new Date(),
          priceCents: 0,
        })
        .returning()
    );
  }

  async function bought(contentId: string, customerId: string) {
    await db.insert(purchases).values({
      customerId,
      contentId,
      amountPaidCents: 900,
      currency: 'gbp',
      platformFeeCents: 0,
      organizationFeeCents: 0,
      creatorPayoutCents: 900,
      stripePaymentIntentId: `pi_${randomUUID()}`,
      status: 'completed',
      purchasedAt: new Date(),
    });
  }

  const stored = async (id: string) =>
    takeFirst(
      await db.select().from(contentTable).where(eq(contentTable.id, id))
    );

  const noticesOf = (contentId: string) =>
    db
      .select()
      .from(contentLeavingNotices)
      .where(eq(contentLeavingNotices.contentId, contentId));

  describe('keepContent', () => {
    it('keeps a leave an org admin’s delete started', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const piece = await livePiece();
      await bought(piece.id, buyer);
      await service.deleteContent(orgId, piece.id);

      const result = await service.keepContent(orgId, piece.id);

      expect(result).toEqual({ kept: true, staying: 0, stillLeavingBy: null });
      const after = await stored(piece.id);
      expect(after.leavesAt).toBeNull();
      expect([after.leavingByCreator, after.leavingByOrg]).toEqual([
        false,
        false,
      ]);
      expect(after.status).toBe(CONTENT_STATUS.ARCHIVED);
      expect((await noticesOf(piece.id)).map((n) => n.state)).toEqual([
        'cancelled',
      ]);
    });

    it('refuses a leave the creator’s own delete started, writing nothing', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const piece = await livePiece();
      await bought(piece.id, buyer);
      await creatorSide.delete(piece.id, creatorId);

      await expect(service.keepContent(orgId, piece.id)).rejects.toMatchObject(
        notYours('creator')
      );
      const after = await stored(piece.id);
      expect(after.leavesAt).not.toBeNull();
      expect((await noticesOf(piece.id)).map((n) => n.state)).toEqual(['due']);
    });

    it('comes back unchanged for a piece that is not leaving', async () => {
      const piece = await livePiece();

      const result = await service.keepContent(orgId, piece.id);

      expect(result).toEqual({ kept: false, staying: 0, stillLeavingBy: null });
      expect((await stored(piece.id)).status).toBe(CONTENT_STATUS.PUBLISHED);
    });

    it('refuses another org’s piece as not found', async () => {
      const otherOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      const [buyer] = await seedTestUsers(db, 1);
      const piece = await livePiece(otherOrg.id);
      await bought(piece.id, buyer);
      await service.deleteContent(otherOrg.id, piece.id);

      await expect(service.keepContent(orgId, piece.id)).rejects.toThrow(
        NotFoundError
      );
      expect((await stored(piece.id)).leavesAt).not.toBeNull();
    });
  });

  describe('publishContent of a leaving piece', () => {
    it('refuses it: Keep it first', async () => {
      // Its creator on the team, so the leave is what refuses it.
      const teamOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      await joinTeam(db, teamOrg.id, creatorId);
      const [buyer] = await seedTestUsers(db, 1);
      const piece = await livePiece(teamOrg.id);
      await bought(piece.id, buyer);
      await service.deleteContent(teamOrg.id, piece.id);

      await expect(
        service.publishContent(teamOrg.id, piece.id)
      ).rejects.toMatchObject({
        statusCode: 409,
        context: { code: 'CONTENT_LEAVING' },
      });
    });
  });

  describe('takedownContent', () => {
    it('deletes a leaving piece at once: its notices cancelled, a removed row each, its date cleared', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const piece = await livePiece();
      await bought(piece.id, buyer);
      const { leavesAt } = await service.deleteContent(orgId, piece.id);
      if (!leavesAt) throw new Error('expected a leave date');
      await db.insert(contentLeavingNotices).values({
        contentId: piece.id,
        userId: buyer,
        kind: 'reminder',
        round: leavesAt,
      });

      const taken = await service.takedownContent(piece.id);

      expect(taken).toEqual({
        holders: 1,
        organizationId: orgId,
        creatorId,
      });
      const after = await stored(piece.id);
      expect(after.deletedAt).not.toBeNull();
      // A deleted piece with a date is one that left with notice. Nor is
      // the leave anyone's any more (the org's, as an org admin deleted it).
      expect(after.leavesAt).toBeNull();
      expect([after.leavingByCreator, after.leavingByOrg]).toEqual([
        false,
        false,
      ]);
      const byKind = Object.fromEntries(
        (await noticesOf(piece.id)).map((n) => [n.kind, n.state])
      );
      expect(byKind).toEqual({
        leaving: 'cancelled',
        reminder: 'cancelled',
        removed: 'due',
      });
    });

    it('cancels a kept piece’s open staying email', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const piece = await livePiece();
      await bought(piece.id, buyer);
      const { leavesAt } = await service.deleteContent(orgId, piece.id);
      if (!leavesAt) throw new Error('expected a leave date');
      await db.insert(contentLeavingNotices).values({
        contentId: piece.id,
        userId: buyer,
        kind: 'staying',
        round: leavesAt,
      });
      // As Keep leaves it: no date, and so no side that started one.
      await db
        .update(contentTable)
        .set({ leavesAt: null, leavingByCreator: false, leavingByOrg: false })
        .where(eq(contentTable.id, piece.id));

      await service.takedownContent(piece.id);

      const staying = (await noticesOf(piece.id)).find(
        (n) => n.kind === 'staying'
      );
      expect(staying?.state).toBe('cancelled');
    });

    it('takes down a piece nobody holds, writing no notice', async () => {
      const piece = await livePiece();

      const taken = await service.takedownContent(piece.id);

      expect(taken.holders).toBe(0);
      expect((await stored(piece.id)).deletedAt).not.toBeNull();
      expect(await noticesOf(piece.id)).toEqual([]);
    });

    it('refuses a piece already gone', async () => {
      const piece = await livePiece();
      await service.takedownContent(piece.id);

      await expect(service.takedownContent(piece.id)).rejects.toThrow(
        NotFoundError
      );
    });
  });
});
