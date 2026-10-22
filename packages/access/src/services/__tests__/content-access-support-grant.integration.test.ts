/**
 * Support grants: access and the library shelf (Codex-2hxff.21).
 *
 * The Studio's grant dialog used to write a `content_access` row that nothing
 * reads, so a "granted" customer could neither stream the item nor see it.
 * The writer (`AdminCustomerManagementService.grantContentAccess`) now writes
 * a `grant` entitlement; this suite drives that exact row through the two
 * readers that matter:
 *
 *   - the access decision (`canView`, `getStreamingUrl`), which has read
 *     `grant` entitlements all along (`CONTENT_GRANT_SOURCES`);
 *   - the library, whose purchased arm now unions live grants in.
 *
 * The rows are inserted here in the writer's shape rather than through the
 * admin service, because `@codex/access` cannot depend on `@codex/admin`. The
 * admin suite pins that the writer produces this shape.
 *
 * Revocation is the other half: a revoked grant is denied and leaves the
 * shelf, while a purchase of the same item keeps granting.
 *
 * The last test ties `isGrantableContent` (`@codex/constants`, the rule the
 * writer and the Studio pickers use) to the decision itself.
 */

import {
  createR2SigningClientFromEnv,
  type R2SigningClient,
} from '@codex/cloudflare-clients';
import { canBeSold, isGrantableContent } from '@codex/constants';
import { ContentService, MediaItemService } from '@codex/content';
import {
  content,
  entitlements,
  organizationMemberships,
  organizations,
  purchases,
  stripeConnectAccounts,
  subscriptionTiers,
} from '@codex/database/schema';
import type { PurchaseService } from '@codex/purchase';
import {
  createTestConnectAccountInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { getOriginalKey } from '@codex/transcoding';
import type { ListUserLibraryInput } from '@codex/validation';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AccessDeniedError } from '../../errors';
import { ContentAccessService } from '../ContentAccessService';

describe('support grants — access and library (Codex-2hxff.21)', () => {
  let db: Database;
  let accessService: ContentAccessService;
  let contentService: ContentService;
  let mediaService: MediaItemService;
  let r2Client: R2SigningClient;
  let creatorId: string;
  let supportUserId: string;
  let organizationId: string;
  let otherOrganizationId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const config = { db, environment: 'test' as const };
    contentService = new ContentService(config);
    mediaService = new MediaItemService(config);
    r2Client = createR2SigningClientFromEnv();

    accessService = new ContentAccessService({
      db,
      environment: 'test',
      r2: r2Client,
      // No `purchases`-row path in this suite: a purchase is proved through
      // its `content_purchase` entitlement, the row `completePurchase` writes.
      purchaseService: {
        verifyPurchase: vi.fn(async () => false),
      } as unknown as PurchaseService,
      contentApiBaseUrl: 'https://api.revelations.studio',
      hlsTokenSecret: 'test-worker-shared-secret',
    });

    const [creator, support] = await seedTestUsers(db, 2);
    if (!creator || !support) throw new Error('Failed to seed users');
    creatorId = creator;
    supportUserId = support;

    // Publishing paid content needs a payout-ready Connect account.
    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, creatorId))
      .onConflictDoNothing();

    const [org, otherOrg] = await db
      .insert(organizations)
      .values([
        { name: 'Grant Org', slug: createUniqueSlug('grant-org') },
        { name: 'Other Org', slug: createUniqueSlug('grant-other-org') },
      ])
      .returning();
    if (!org || !otherOrg) throw new Error('Failed to seed orgs');
    organizationId = org.id;
    otherOrganizationId = otherOrg.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /** A published PAID video in `orgId`, ready to stream. */
  async function createPaidContent(slugSuffix: string, orgId = organizationId) {
    const media = await mediaService.create(
      {
        title: slugSuffix,
        mediaType: 'video',
        mimeType: 'video/mp4',
        r2Key: getOriginalKey(
          creatorId,
          crypto.randomUUID(),
          `${slugSuffix}.mp4`
        ),
        fileSizeBytes: 1024,
      },
      creatorId
    );
    await mediaService.markAsReady(
      media.id,
      {
        hlsMasterPlaylistKey: `hls/${slugSuffix}/master.m3u8`,
        thumbnailKey: `thumbnails/${slugSuffix}.jpg`,
        durationSeconds: 120,
      },
      creatorId
    );
    const item = await contentService.create(
      {
        organizationId: orgId,
        title: slugSuffix,
        slug: createUniqueSlug(slugSuffix),
        contentType: 'video',
        mediaItemId: media.id,
        priceCents: 1500,
        tags: [],
      },
      creatorId
    );
    await contentService.publish(item.id, creatorId);
    return item;
  }

  /** A grant, in the shape `grantContentAccess` writes. */
  async function grant(
    customerId: string,
    contentId: string,
    orgId = organizationId
  ) {
    const [row] = await db
      .insert(entitlements)
      .values({
        userId: customerId,
        organizationId: orgId,
        contentId,
        source: 'grant',
        grantedByUserId: supportUserId,
      })
      .returning();
    if (!row) throw new Error('Failed to write grant');
    return row;
  }

  /** A revoke, in the shape `revokeGrant` writes. */
  async function revoke(entitlementId: string) {
    await db
      .update(entitlements)
      .set({ revokedAt: new Date(), revokedByUserId: supportUserId })
      .where(eq(entitlements.id, entitlementId));
  }

  async function library(
    userId: string,
    overrides: Partial<ListUserLibraryInput> = {}
  ) {
    return accessService.listUserLibrary(userId, {
      page: 1,
      limit: 50,
      filter: 'all',
      sortBy: 'recent',
      contentType: 'all',
      accessType: 'all',
      search: '',
      ...overrides,
    });
  }

  it('a live grant lets the customer stream the item and shelves it as purchased', async () => {
    const [customer] = await seedTestUsers(db, 1);
    const item = await createPaidContent('granted-practice');

    // Before: paid content, no purchase — denied, and nothing on the shelf.
    expect(await accessService.canView(customer, item.id)).toBe(false);
    await expect(
      accessService.getStreamingUrl(customer, {
        contentId: item.id,
        expirySeconds: 600,
      })
    ).rejects.toThrow(AccessDeniedError);

    await grant(customer, item.id);

    expect(await accessService.canView(customer, item.id)).toBe(true);
    const stream = await accessService.getStreamingUrl(customer, {
      contentId: item.id,
      expirySeconds: 600,
    });
    expect(stream.streamingUrl).toContain('/hls/master.m3u8?token=');

    const all = await library(customer);
    expect(all.items.map((i) => i.content.id)).toEqual([item.id]);
    expect(all.items[0]?.accessType).toBe('purchased');
    // A grant reads as a £0 purchase made when it was granted.
    expect(all.items[0]?.purchase?.priceCents).toBe(0);

    // The `purchased` filter pages over grants too — no new accessType.
    const purchased = await library(customer, { accessType: 'purchased' });
    expect(purchased.items.map((i) => i.content.id)).toEqual([item.id]);
    expect(purchased.pagination.total).toBe(1);
  });

  it('a revoked grant is denied and leaves the shelf', async () => {
    const [customer] = await seedTestUsers(db, 1);
    const item = await createPaidContent('revoked-practice');

    const row = await grant(customer, item.id);
    expect(await accessService.canView(customer, item.id)).toBe(true);

    await revoke(row.id);

    expect(await accessService.canView(customer, item.id)).toBe(false);
    await expect(
      accessService.getStreamingUrl(customer, {
        contentId: item.id,
        expirySeconds: 600,
      })
    ).rejects.toThrow(AccessDeniedError);
    const all = await library(customer);
    expect(all.items).toHaveLength(0);
    expect(all.pagination.total).toBe(0);
  });

  it('bought AND granted is one shelf row at the price paid, and revoking the grant leaves the purchase granting', async () => {
    const [customer] = await seedTestUsers(db, 1);
    const item = await createPaidContent('bought-and-granted');

    const [purchase] = await db
      .insert(purchases)
      .values({
        customerId: customer,
        contentId: item.id,
        organizationId,
        amountPaidCents: 1500,
        currency: 'gbp',
        platformFeeCents: 150,
        organizationFeeCents: 0,
        creatorPayoutCents: 1350,
        stripePaymentIntentId: `pi_test_${crypto.randomUUID()}`,
        status: 'completed',
        purchasedAt: new Date(),
      })
      .returning();
    if (!purchase) throw new Error('Failed to seed purchase');
    await db.insert(entitlements).values({
      userId: customer,
      organizationId,
      contentId: item.id,
      source: 'content_purchase',
      sourceRef: purchase.id,
    });
    const grantRow = await grant(customer, item.id);

    const before = await library(customer, { accessType: 'purchased' });
    expect(before.items).toHaveLength(1);
    expect(before.pagination.total).toBe(1);
    expect(before.items[0]?.purchase?.priceCents).toBe(1500);

    await revoke(grantRow.id);

    expect(await accessService.canView(customer, item.id)).toBe(true);
    const after = await library(customer);
    expect(after.items.map((i) => i.content.id)).toEqual([item.id]);
    expect(after.items[0]?.purchase?.priceCents).toBe(1500);
  });

  it('a grant keeps its item out of the other arms, so the shelf total is honest', async () => {
    // A management member sees every item of their org on the membership
    // arm. The granted one must show once, as purchased, and count once.
    const [customer] = await seedTestUsers(db, 1);
    const [memberOrg] = await db
      .insert(organizations)
      .values({ name: 'Member Org', slug: createUniqueSlug('grant-member') })
      .returning();
    if (!memberOrg) throw new Error('Failed to seed org');
    await db.insert(organizationMemberships).values({
      userId: customer,
      organizationId: memberOrg.id,
      role: 'admin',
      status: 'active',
    });
    const granted = await createPaidContent('member-granted', memberOrg.id);
    const other = await createPaidContent('member-other', memberOrg.id);

    await grant(customer, granted.id, memberOrg.id);

    const all = await library(customer);
    const byId = new Map(all.items.map((i) => [i.content.id, i.accessType]));
    expect(byId.get(granted.id)).toBe('purchased');
    expect(byId.get(other.id)).toBe('membership');
    expect(all.items).toHaveLength(2);
    expect(all.pagination.total).toBe(2);

    const membership = await library(customer, { accessType: 'membership' });
    expect(membership.items.map((i) => i.content.id)).toEqual([other.id]);
  });

  it('a grant on deleted content leaves the shelf', async () => {
    const [customer] = await seedTestUsers(db, 1);
    const item = await createPaidContent('deleted-granted');
    await grant(customer, item.id);
    expect((await library(customer)).items).toHaveLength(1);

    await db
      .update(content)
      .set({ deletedAt: new Date() })
      .where(eq(content.id, item.id));

    expect((await library(customer)).items).toHaveLength(0);
  });

  it("honours the library's organization filter", async () => {
    const [customer] = await seedTestUsers(db, 1);
    const item = await createPaidContent('org-filtered-grant');
    await grant(customer, item.id);

    const here = await library(customer, { organizationId });
    expect(here.items.map((i) => i.content.id)).toEqual([item.id]);

    const elsewhere = await library(customer, {
      organizationId: otherOrganizationId,
    });
    expect(elsewhere.items).toHaveLength(0);
  });

  // The writer refuses what `isGrantableContent` refuses, so the predicate
  // must say exactly where a grant changes the decision. "Allowed iff
  // grantable" would be wrong for free content, which everyone can open, so
  // the comparison is a granted user against an identical ungranted one: the
  // grant must flip denied → allowed iff the predicate is true.
  describe('isGrantableContent agrees with the access decision', () => {
    const neutral = {
      isFree: false,
      isPurchasable: false,
      priceCents: null,
      includedInTierId: null,
      courseOnly: false,
      isFollowerGated: false,
      isTeamOnly: false,
    };

    // The second column pins the expected answer, so the agreement cannot pass
    // vacuously (a decision that always denied would "agree" on four of six).
    it.each([
      ['paid', true, { isPurchasable: true, priceCents: 1500 }],
      ['tier (subscriber)', true, 'tier' as const],
      ['free', false, { isFree: true, priceCents: 0 }],
      ['followers-only', false, { isFollowerGated: true }],
      ['team-only', false, { isTeamOnly: true }],
      ['course-only', false, { courseOnly: true }],
    ])('%s: a grant opens it = %s', async (shape, opens, flagsOrTier) => {
      const [granted, ungranted] = await seedTestUsers(db, 2);
      const item = await createPaidContent(
        `grantable-${shape.replace(/[^a-z]+/g, '-').replace(/-+$/, '')}`
      );
      const flags =
        flagsOrTier === 'tier'
          ? {
              includedInTierId: (
                await db
                  .insert(subscriptionTiers)
                  .values(createTestTierInput(organizationId))
                  .returning()
              )[0]?.id,
            }
          : flagsOrTier;
      const [row] = await db
        .update(content)
        .set({ ...neutral, ...flags })
        .where(eq(content.id, item.id))
        .returning();
      if (!row) throw new Error('Failed to set the content shape');

      await grant(granted, item.id);

      const grantOpensIt =
        (await accessService.canView(granted, item.id)) &&
        !(await accessService.canView(ungranted, item.id));
      expect(grantOpensIt).toBe(opens);
      expect(isGrantableContent(row)).toBe(opens);
    });
  });

  // Checkout sells only what `canBeSold` accepts (Codex-2hxff.14), so whatever
  // it accepts, a purchase must open. The converse need not hold: the access
  // decision ignores `isPurchasable`, a seller's choice, so a purchase would
  // open priced content that is not for sale. The table pins both columns.
  describe('canBeSold agrees with the access decision', () => {
    const forSale = {
      isFree: false,
      isPurchasable: true,
      priceCents: 1500,
      includedInTierId: null,
      courseOnly: false,
      isFollowerGated: false,
      isTeamOnly: false,
    };

    it.each([
      ['paid, for sale', true, true, {}],
      ['paid, not marked purchasable', false, true, { isPurchasable: false }],
      ['course-only', false, false, { courseOnly: true }],
      ['team-only', false, false, { isTeamOnly: true }],
      ['followers-only', false, false, { isFollowerGated: true }],
    ])('%s: sold = %s, a purchase opens it = %s', async (shape, sold, opens, flags) => {
      const [buyer, other] = await seedTestUsers(db, 2);
      const item = await createPaidContent(
        `sellable-${shape.replace(/[^a-z]+/g, '-').replace(/-+$/, '')}`
      );
      const [row] = await db
        .update(content)
        .set({ ...forSale, ...flags })
        .where(eq(content.id, item.id))
        .returning();
      if (!row) throw new Error('Failed to set the content shape');

      // A purchase, as `completePurchase` records it for the decision.
      await db.insert(entitlements).values({
        userId: buyer,
        organizationId,
        contentId: item.id,
        source: 'content_purchase',
      });

      const purchaseOpensIt =
        (await accessService.canView(buyer, item.id)) &&
        !(await accessService.canView(other, item.id));
      expect(canBeSold(row)).toBe(sold);
      expect(purchaseOpensIt).toBe(opens);
      // The invariant checkout relies on: never sell what a purchase won't open.
      if (canBeSold(row)) expect(purchaseOpensIt).toBe(true);
    });
  });
});
