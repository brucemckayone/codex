/**
 * When does access refuse a BUYER of a piece of content? (Codex-z1t3c, D54)
 *
 * A buyer here holds exactly what `completePurchase` writes, a completed
 * `purchases` row and its `content_purchase` entitlement, and nothing else:
 * no team role, follow, subscription or course. Each case states whether
 * access opens the item to them, through the real `canView` and the real
 * `verifyPurchase`.
 *
 * Purchase completion blocks and refunds a sale exactly when access would
 * refuse its buyer ("match access exactly", owner 2026-11-15), so this table
 * is the rule both sides read. It was written against the access decision
 * BEFORE its branch order moved to @codex/constants, and runs unchanged after.
 * Each case also holds the shared predicate completion calls,
 * `contentRefusesBuyers`, to the real decision on the same row: a rule access
 * adds that the predicate misses fails here.
 *
 * Real DB. Every row hangs off this file's own users and organisations, and is
 * deleted in afterAll.
 */

import { randomUUID } from 'node:crypto';
import { createR2SigningClientFromEnv } from '@codex/cloudflare-clients';
import { contentRefusesBuyers } from '@codex/constants';
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

  const cases: Array<[string, Shape, After, boolean, boolean]> = [
    // name, shape after the sale, change after the sale, orgless, opens
    ['paid, published', {}, 'none', false, true],
    ['orgless paid, published', {}, 'none', true, true],
    [
      'paid, unpublished after release',
      { status: 'draft', publishedAt: released },
      'none',
      false,
      true,
    ],
    [
      'paid, taken off sale (archived)',
      { status: 'archived', publishedAt: released, offSaleAt: new Date() },
      'none',
      false,
      true,
    ],
    [
      'subscribers (tier switch on, none ticked), bought',
      { isTierGated: true },
      'none',
      false,
      true,
    ],
    [
      'free, published (open to everyone)',
      { isFree: true, isPurchasable: false, priceCents: 0 },
      'none',
      false,
      true,
    ],
    ['deleted', {}, 'delete', false, false],
    ['its organisation deleted', {}, 'delete_org', false, false],
    ['detached from its organisation', {}, 'detach', false, false],
    [
      'a draft never released',
      { status: 'draft', publishedAt: null },
      'none',
      false,
      false,
    ],
    ['team-only', { isTeamOnly: true }, 'none', false, false],
    ['course-only', { courseOnly: true }, 'none', false, false],
    ['followers-only', { isFollowerGated: true }, 'none', false, false],
    ['orgless, with a tier', { isTierGated: true }, 'none', true, false],
    [
      'free, unpublished after release',
      {
        isFree: true,
        isPurchasable: false,
        priceCents: 0,
        status: 'draft',
        publishedAt: released,
      },
      'none',
      false,
      false,
    ],
  ];

  it.each(
    cases.map(([name, shape, after, orgless, opens]) => ({
      name,
      shape,
      after,
      orgless,
      opens,
    }))
  )('$name: a buyer is let in = $opens', async ({
    shape,
    after,
    orgless,
    opens,
  }) => {
    const { buyerId, contentId } = await soldItem(shape, after, orgless);

    expect(await accessService.canView(buyerId, contentId)).toBe(opens);
    // The shared predicate agrees with the real decision on the same row.
    expect(contentRefusesBuyers(await buyerFacts(contentId))).toBe(!opens);
  });
});
