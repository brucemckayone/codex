/**
 * When does access refuse a BUYER of a piece of content? (Codex-z1t3c, D54)
 *
 * A buyer here holds exactly what `completePurchase` writes, a completed
 * `purchases` row and its `content_purchase` entitlement, and nothing else:
 * no team role, follow, subscription or course. Each case states two things:
 * - `ownerOpens`: does access open the item to them, through the real
 *   `canView` and the real `verifyPurchase`? They bought it before the change.
 * - `completionRefuses`: does the shared predicate completion calls,
 *   `contentRefusesBuyers`, refuse a NEW buyer of the item as it now stands?
 *
 * The rule both sides read (payments restating D54 for the leaving notice,
 * 2026-11-17): "completion is blocked whenever access would refuse a NEW
 * buyer; existing owners keep it when access moves". So over every case:
 * (i) an owner refused means completion refuses (never charge for what will
 * not open); (ii) the cases where completion refuses yet an owner opens are
 * EXACTLY the ones the leaving notice and D2 name (Codex-a6ofh.6.3): a
 * leaving piece, course-only, team-only, followers-only, and free once
 * unpublished. A rule added on either side that breaks that fails here.
 *
 * Real DB. Every row hangs off this file's own users and organisations, and is
 * deleted in afterAll.
 */

import { randomUUID } from 'node:crypto';
import { createR2SigningClientFromEnv } from '@codex/cloudflare-clients';
import { contentRefusesBuyers, LEAVING_NOTICE_DAYS } from '@codex/constants';
import {
  content,
  entitlements,
  organizations,
  purchases,
  users,
} from '@codex/database/schema';
import { verifyPurchase } from '@codex/purchase';
import {
  createTestContentInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentAccessService } from '../ContentAccessService';

const uid = () => randomUUID().slice(0, 8);

type Shape = Partial<typeof content.$inferInsert>;

/** How the item is changed after the sale, beyond its flags. */
type After = 'none' | 'delete' | 'delete_org' | 'detach';

/** One case: the item's shape and change after the sale, and both answers. */
interface Case {
  name: string;
  shape: Shape;
  after: After;
  orgless: boolean;
  ownerOpens: boolean;
  completionRefuses: boolean;
}

describe('when access refuses a buyer of the content (Codex-z1t3c)', () => {
  let db: Database;
  let accessService: ContentAccessService;
  let creatorId: string;
  const buyerIds: string[] = [];
  const orgIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    accessService = new ContentAccessService({
      db,
      environment: 'test',
      r2: createR2SigningClientFromEnv(),
      // The real purchase read, as `PurchaseService.verifyPurchase` runs it.
      purchaseService: {
        verifyPurchase: (contentId: string, customerId: string) =>
          verifyPurchase(db, contentId, customerId),
      },
      contentApiBaseUrl: 'https://api.revelations.studio',
      hlsTokenSecret: 'test-worker-shared-secret',
    });
    [creatorId] = await seedTestUsers(db, 1);
  });

  afterAll(async () => {
    if (buyerIds.length > 0) {
      await db
        .delete(entitlements)
        .where(inArray(entitlements.userId, buyerIds));
      await db.delete(purchases).where(inArray(purchases.customerId, buyerIds));
    }
    await db.delete(content).where(eq(content.creatorId, creatorId));
    if (orgIds.length > 0) {
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
    await db.delete(users).where(inArray(users.id, [...buyerIds, creatorId]));
    await teardownTestDatabase();
  });

  /**
   * A published £15 item in an org of its own, bought by a buyer of its own;
   * then the shape and the change applied after the sale.
   */
  async function soldItem(shape: Shape, after: After, orgless: boolean) {
    const orgId = orgless
      ? null
      : takeFirst(
          await db
            .insert(organizations)
            .values({ name: `Buyer ${uid()}`, slug: createUniqueSlug('buyer') })
            .returning()
        ).id;
    if (orgId) orgIds.push(orgId);
    const item = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgId,
            contentType: 'written',
            slug: createUniqueSlug('buyer-item'),
            status: 'published',
            publishedAt: new Date(),
            isFree: false,
            isPurchasable: true,
            priceCents: 1500,
          })
        )
        .returning()
    );
    const [buyerId] = await seedTestUsers(db, 1);
    buyerIds.push(buyerId);
    // What `completePurchase` writes for the sale.
    const sale = takeFirst(
      await db
        .insert(purchases)
        .values({
          customerId: buyerId,
          contentId: item.id,
          organizationId: orgId,
          amountPaidCents: 1500,
          currency: 'gbp',
          stripePaymentIntentId: `pi_buyer_${uid()}`,
          status: 'completed',
          purchasedAt: new Date(),
          platformFeeCents: 150,
          organizationFeeCents: 0,
          creatorPayoutCents: 1350,
        })
        .returning()
    );
    await db.insert(entitlements).values({
      userId: buyerId,
      organizationId: orgId,
      contentId: item.id,
      source: 'content_purchase',
      sourceRef: sale.id,
    });

    if (Object.keys(shape).length > 0) {
      await db.update(content).set(shape).where(eq(content.id, item.id));
    }
    if (after === 'delete') {
      await db
        .update(content)
        .set({ deletedAt: new Date() })
        .where(eq(content.id, item.id));
    }
    if (after === 'delete_org' && orgId) {
      await db
        .update(organizations)
        .set({ deletedAt: new Date() })
        .where(eq(organizations.id, orgId));
    }
    if (after === 'detach') {
      // Migration 0004's trigger makes it a draft and nulls published_at.
      await db
        .update(content)
        .set({ organizationId: null })
        .where(eq(content.id, item.id));
    }
    return { buyerId, contentId: item.id };
  }

  /**
   * The facts `contentRefusesBuyers` reads, as the item now stands, read as
   * completion reads them: the organisation the content row names.
   */
  async function buyerFacts(contentId: string) {
    const row = takeFirst(
      await db.select().from(content).where(eq(content.id, contentId))
    );
    const org = row.organizationId
      ? takeFirst(
          await db
            .select({ deletedAt: organizations.deletedAt })
            .from(organizations)
            .where(eq(organizations.id, row.organizationId))
        )
      : null;
    return { ...row, organizationDeleted: org?.deletedAt != null };
  }

  const released = new Date('2026-01-01T00:00:00Z');
  const leaves = new Date(
    Date.now() + LEAVING_NOTICE_DAYS * 24 * 60 * 60 * 1000
  );

  /** Every case where an owner opens and a new buyer is let in. */
  const opens = (name: string, shape: Shape, orgless = false): Case => ({
    name,
    shape,
    after: 'none',
    orgless,
    ownerOpens: true,
    completionRefuses: false,
  });
  /** Gone to everyone: owner refused, new buyer refused. */
  const gone = (
    name: string,
    shape: Shape,
    after: After,
    orgless = false
  ): Case => ({
    name,
    shape,
    after,
    orgless,
    ownerOpens: false,
    completionRefuses: true,
  });
  /** The owner keeps it; no one new buys in. */
  const kept = (name: string, shape: Shape): Case => ({
    name,
    shape,
    after: 'none',
    orgless: false,
    ownerOpens: true,
    completionRefuses: true,
  });

  const cases: Case[] = [
    opens('paid, published', {}),
    opens('orgless paid, published', {}, true),
    opens('paid, unpublished after release', {
      status: 'draft',
      publishedAt: released,
    }),
    opens('paid, taken off sale (archived)', {
      status: 'archived',
      publishedAt: released,
      offSaleAt: new Date(),
    }),
    opens('subscribers (tier switch on, none ticked), bought', {
      isTierGated: true,
    }),
    opens('free, published (open to everyone)', {
      isFree: true,
      isPurchasable: false,
      priceCents: 0,
    }),
    gone('deleted', {}, 'delete'),
    gone('its organisation deleted', {}, 'delete_org'),
    gone('detached from its organisation', {}, 'detach'),
    gone(
      'a draft never released',
      { status: 'draft', publishedAt: null },
      'none'
    ),
    gone('orgless, with a tier', { isTierGated: true }, 'none', true),
    // Deleted with notice: archived and off sale, as the delete writes it.
    kept('leaving', {
      status: 'archived',
      publishedAt: released,
      offSaleAt: new Date(),
      leavesAt: leaves,
      leavingByCreator: true,
    }),
    kept('team-only', { isTeamOnly: true }),
    kept('course-only', { courseOnly: true }),
    kept('followers-only', { isFollowerGated: true }),
    kept('free, unpublished after release', {
      isFree: true,
      isPurchasable: false,
      priceCents: 0,
      status: 'draft',
      publishedAt: released,
    }),
  ];

  it.each(
    cases
  )('$name: owner opens = $ownerOpens, completion refuses = $completionRefuses', async ({
    shape,
    after,
    orgless,
    ownerOpens,
    completionRefuses,
  }) => {
    const { buyerId, contentId } = await soldItem(shape, after, orgless);

    expect(await accessService.canView(buyerId, contentId)).toBe(ownerOpens);
    expect(contentRefusesBuyers(await buyerFacts(contentId))).toBe(
      completionRefuses
    );
  });

  // Over the table, which each case above holds to the real decision and the
  // real predicate.
  it('(i) wherever an owner is refused, completion refuses a new buyer', () => {
    const chargedForNothing = cases.filter(
      (c) => !c.ownerOpens && !c.completionRefuses
    );
    expect(chargedForNothing).toEqual([]);
  });

  it('(ii) completion refuses where an owner opens EXACTLY in the agreed set', () => {
    const keptButNotSold = cases
      .filter((c) => c.ownerOpens && c.completionRefuses)
      .map((c) => c.name)
      .sort();
    expect(keptButNotSold).toEqual(
      [
        'leaving',
        'course-only',
        'team-only',
        'followers-only',
        'free, unpublished after release',
      ].sort()
    );
  });
});
