/**
 * The withdrawn read's lookup, against real Postgres (Codex-ov2ii).
 *
 * `getWithdrawnContent` answers only for a row that was released once
 * (`publishedAt` set), is not published now, is not deleted, and matches the
 * detail URL's key: an org piece by `(orgId, slug)`, a personal piece by
 * `(creatorId, slug)` with no org. The stub suite
 * (content-access-service-withdrawn.test.ts) cannot see that WHERE, because a
 * stub returns whatever row it is given; this file pins it, with a buyer who
 * bought every paid row, so a 404 here is the lookup and never the decision.
 *
 * Every row this file writes is deleted in `afterAll`: purchases and
 * subscriptions are tables whole-table jobs read.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  organizations,
  purchases,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import { PurchaseService } from '@codex/purchase';
import {
  createTestContentInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentNotFoundError } from '../../errors';
import { ContentAccessService } from '../ContentAccessService';

type R2 = ConstructorParameters<typeof ContentAccessService>[0]['r2'];

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);
const daysFromNow = (n: number): Date => new Date(Date.now() + n * DAY);

const IN_PERIOD_END = daysFromNow(10);

describe('getWithdrawnContent: which rows the lookup can find (Codex-ov2ii)', () => {
  let db: Database;
  let svc: ContentAccessService;

  let orgId: string;
  let creatorId: string;
  let buyerId: string;
  let inPeriodSubId: string;
  let renewedSubId: string;
  let strangerId: string;

  const slugs: Record<string, string> = {};
  const contentIds: string[] = [];
  const purchaseIds: string[] = [];

  async function insertContent(
    key: string,
    overrides: Parameters<typeof createTestContentInput>[1]
  ): Promise<string> {
    const [row] = await db
      .insert(content)
      .values(
        createTestContentInput(creatorId, {
          organizationId: orgId,
          // Written: nothing to sign, no media.
          contentType: 'written',
          isFree: false,
          ...overrides,
        })
      )
      .returning({ id: content.id, slug: content.slug });
    if (!row) throw new Error(`failed to seed ${key}`);
    contentIds.push(row.id);
    slugs[key] = row.slug;
    return row.id;
  }

  async function buy(contentId: string, organizationId: string | null) {
    const [row] = await db
      .insert(purchases)
      .values({
        customerId: buyerId,
        contentId,
        organizationId,
        amountPaidCents: 900,
        currency: 'gbp',
        platformFeeCents: 0,
        organizationFeeCents: 0,
        creatorPayoutCents: 900,
        stripePaymentIntentId: `pi_${randomUUID()}`,
        status: 'completed',
        purchasedAt: daysAgo(40),
        createdAt: daysAgo(40),
      })
      .returning({ id: purchases.id });
    if (!row) throw new Error('failed to seed purchase');
    purchaseIds.push(row.id);
  }

  const inOrg = (key: string) => ({ orgId, slug: slugs[key] ?? '' });

  beforeAll(async () => {
    db = setupTestDatabase();
    const [creator, buyer, inPeriodSub, renewedSub, stranger] =
      await seedTestUsers(db, 5);
    if (!creator || !buyer || !inPeriodSub || !renewedSub || !stranger) {
      throw new Error('failed to seed test users');
    }
    creatorId = creator;
    buyerId = buyer;
    inPeriodSubId = inPeriodSub;
    renewedSubId = renewedSub;
    strangerId = stranger;

    // Real verifyPurchase against the purchases table; Stripe is never reached.
    const purchaseService = new PurchaseService(
      { db, environment: 'test' },
      {} as Stripe
    );
    const r2 = new Proxy(
      {},
      {
        get: () => {
          throw new Error('signing ran: the withdrawn read signs nothing');
        },
      }
    ) as R2;
    svc = new ContentAccessService({
      db,
      environment: 'test',
      r2,
      purchaseService,
    });

    const [org] = await db
      .insert(organizations)
      .values({ name: 'Withdrawn org', slug: createUniqueSlug('withdrawn') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create org');
    orgId = org.id;

    const [tier] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(orgId, { sortOrder: 1 }))
      .returning({ id: subscriptionTiers.id });
    if (!tier) throw new Error('failed to create tier');

    await db.insert(subscriptions).values([
      // The item went off sale 5 days ago, inside this period.
      createTestSubscriptionInput(inPeriodSubId, orgId, tier.id, {
        currentPeriodStart: daysAgo(20),
        currentPeriodEnd: IN_PERIOD_END,
      }),
      // Renewed after it went off sale: covered no longer.
      createTestSubscriptionInput(renewedSubId, orgId, tier.id, {
        currentPeriodStart: daysAgo(2),
        currentPeriodEnd: daysFromNow(28),
      }),
    ]);

    const paid = { isPurchasable: true, priceCents: 900 };
    await buy(
      await insertContent('unpublished', {
        ...paid,
        status: 'draft',
        publishedAt: daysAgo(30),
      }),
      orgId
    );
    await buy(
      await insertContent('neverReleased', {
        ...paid,
        status: 'draft',
        publishedAt: null,
      }),
      orgId
    );
    await buy(
      await insertContent('published', {
        ...paid,
        status: 'published',
        publishedAt: daysAgo(30),
      }),
      orgId
    );
    await buy(
      await insertContent('deleted', {
        ...paid,
        status: 'draft',
        publishedAt: daysAgo(30),
        deletedAt: daysAgo(1),
      }),
      orgId
    );
    await buy(
      await insertContent('personal', {
        ...paid,
        organizationId: null,
        status: 'draft',
        publishedAt: daysAgo(30),
      }),
      null
    );
    await insertContent('departedTier', {
      includedInTierId: tier.id,
      status: 'archived',
      publishedAt: daysAgo(30),
      offSaleAt: daysAgo(5),
    });
  });

  afterAll(async () => {
    if (db && orgId) {
      if (purchaseIds.length > 0) {
        await db.delete(purchases).where(inArray(purchases.id, purchaseIds));
      }
      if (contentIds.length > 0) {
        await db.delete(content).where(inArray(content.id, contentIds));
      }
      await db
        .delete(subscriptions)
        .where(eq(subscriptions.organizationId, orgId));
      await db
        .delete(subscriptionTiers)
        .where(eq(subscriptionTiers.organizationId, orgId));
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }
    await teardownTestDatabase();
  });

  it('finds an unpublished piece its buyer bought', async () => {
    const result = await svc.getWithdrawnContent(buyerId, inOrg('unpublished'));

    expect(result.content.slug).toBe(slugs.unpublished);
    expect(result.content.contentBody).toBeNull();
    expect(result.held).toEqual({ by: 'purchase', until: null });
  });

  it('selects the public list’s columns, never the whole org row (Codex-567de)', async () => {
    const result = await svc.getWithdrawnContent(buyerId, inOrg('unpublished'));

    // `deletedAt` is the deleted-org check's; the route never sends it. The
    // payee's primaryConnectAccountUserId is never selected at all.
    expect(Object.keys(result.content.organization ?? {}).sort()).toEqual([
      'deletedAt',
      'id',
      'logoUrl',
      'name',
      'slug',
    ]);
    expect(Object.keys(result.content.creator).sort()).toEqual(['id', 'name']);
    // The public list's content columns too: no sales count.
    expect(result.content).not.toHaveProperty('purchaseCount');
    expect(result.content).toHaveProperty('viewCount');
  });

  it('finds a departed creator’s item for a subscriber, until their period ends', async () => {
    const result = await svc.getWithdrawnContent(
      inPeriodSubId,
      inOrg('departedTier')
    );

    expect(result.held).toEqual({
      by: 'subscription',
      until: IN_PERIOD_END.toISOString(),
    });
  });

  it.each([
    ['a draft never released, though they bought it', 'neverReleased'],
    ['a published piece: the public list serves it', 'published'],
    ['a deleted piece', 'deleted'],
  ])('never finds %s', async (_label, key) => {
    await expect(svc.getWithdrawnContent(buyerId, inOrg(key))).rejects.toThrow(
      ContentNotFoundError
    );
  });

  it('is a 404 for a reader who never had it', async () => {
    await expect(
      svc.getWithdrawnContent(strangerId, inOrg('unpublished'))
    ).rejects.toThrow(ContentNotFoundError);
  });

  it('is a 404 for a subscriber who renewed after the item went off sale', async () => {
    await expect(
      svc.getWithdrawnContent(renewedSubId, inOrg('departedTier'))
    ).rejects.toThrow(ContentNotFoundError);
  });

  it('finds a personal piece by its creator, and never by an org', async () => {
    const byCreator = await svc.getWithdrawnContent(buyerId, {
      creatorId,
      slug: slugs.personal ?? '',
    });
    expect(byCreator.held.by).toBe('purchase');

    await expect(
      svc.getWithdrawnContent(buyerId, inOrg('personal'))
    ).rejects.toThrow(ContentNotFoundError);
  });

  it('never finds an org piece by its creator’s personal key', async () => {
    await expect(
      svc.getWithdrawnContent(buyerId, {
        creatorId,
        slug: slugs.unpublished ?? '',
      })
    ).rejects.toThrow(ContentNotFoundError);
  });

  it('never finds a piece under another org’s id', async () => {
    await expect(
      svc.getWithdrawnContent(buyerId, {
        orgId: randomUUID(),
        slug: slugs.unpublished ?? '',
      })
    ).rejects.toThrow(ContentNotFoundError);
  });
});
