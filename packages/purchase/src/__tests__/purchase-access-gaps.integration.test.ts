/**
 * Access gaps in one-off purchases (Codex-2hxff.21).
 *
 * - **Orgless entitlement.** `entitlements.organization_id` was NOT NULL, so a
 *   creator's own sale outside any organisation wrote no entitlement and
 *   leaned on `verifyPurchase` alone. Migration 0108 made it nullable; the
 *   sale now writes its `content_purchase` entitlement with the org NULL.
 * - **Solo sales.** `/sales` is scoped to an organisation, so a solo
 *   creator's sales showed in no list. `listMySales` / `getMySalesStats`
 *   scope to orgless purchases of the creator's own content — never an
 *   organisation's sale, never another creator's.
 * - **Course purchases in history.** `getPurchaseHistory` filtered
 *   `content_id IS NOT NULL`, so a course purchase never appeared.
 *
 * Purchases are seeded as rows (or through `completePurchase` where the
 * write under test is the completion's own); no Stripe call is made.
 */

import * as schema from '@codex/database/schema';
import {
  createMockStripe,
  createTestMediaItemInput,
  createTestOrganizationInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PurchaseService } from '../services/purchase-service';

describe('PurchaseService — access gaps (Codex-2hxff.21)', () => {
  let db: Database;
  let service: PurchaseService;

  beforeAll(() => {
    db = setupTestDatabase();
    service = new PurchaseService(
      { db, environment: 'test' },
      createMockStripe()
    );
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /** A paid video by `creatorId`; orgless unless `organizationId` is given. */
  async function insertContent(
    creatorId: string,
    organizationId: string | null = null
  ) {
    const media = takeFirst(
      await db
        .insert(schema.mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning()
    );
    return takeFirst(
      await db
        .insert(schema.content)
        .values({
          creatorId,
          organizationId,
          mediaItemId: media.id,
          title: `Gap ${crypto.randomUUID().slice(0, 8)}`,
          slug: createUniqueSlug('gap'),
          contentType: 'video',
          status: 'published',
          priceCents: 1000,
        })
        .returning()
    );
  }

  /** A completed sale with a balanced split (the revenue-split CHECK). */
  async function insertSale(params: {
    customerId: string;
    contentId?: string;
    courseId?: string;
    organizationId: string | null;
    amountPaidCents?: number;
    createdAt?: Date;
  }) {
    const amount = params.amountPaidCents ?? 1000;
    const platformFeeCents = Math.round(amount * 0.1);
    return takeFirst(
      await db
        .insert(schema.purchases)
        .values({
          customerId: params.customerId,
          contentId: params.contentId ?? null,
          courseId: params.courseId ?? null,
          organizationId: params.organizationId,
          amountPaidCents: amount,
          currency: 'gbp',
          platformFeeCents,
          organizationFeeCents: 0,
          creatorPayoutCents: amount - platformFeeCents,
          stripePaymentIntentId: `pi_gap_${crypto.randomUUID()}`,
          status: 'completed',
          purchasedAt: params.createdAt ?? new Date(),
          ...(params.createdAt ? { createdAt: params.createdAt } : {}),
        })
        .returning()
    );
  }

  describe('orgless content purchase', () => {
    it('writes its content_purchase entitlement with organization_id NULL', async () => {
      const [creatorId, buyerId] = await seedTestUsers(db, 2);
      const item = await insertContent(creatorId);

      const purchase = await service.completePurchase(
        `pi_orgless_ent_${crypto.randomUUID()}`,
        {
          customerId: buyerId,
          contentId: item.id,
          organizationId: null,
          amountPaidCents: 1000,
          currency: 'gbp',
        }
      );

      expect(purchase.organizationId).toBeNull();
      const rows = await db
        .select()
        .from(schema.entitlements)
        .where(
          and(
            eq(schema.entitlements.userId, buyerId),
            eq(schema.entitlements.contentId, item.id)
          )
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        source: 'content_purchase',
        organizationId: null,
        sourceRef: purchase.id,
        revokedAt: null,
      });
    });
  });

  describe('solo creator sales (listMySales / getMySalesStats)', () => {
    let creatorId: string;
    let otherCreatorId: string;
    let buyerId: string;
    let orgId: string;
    let soloSaleId: string;
    let orgSaleId: string;
    let otherCreatorSaleId: string;

    beforeAll(async () => {
      [creatorId, otherCreatorId, buyerId] = await seedTestUsers(db, 3);
      orgId = takeFirst(
        await db
          .insert(schema.organizations)
          .values(createTestOrganizationInput())
          .returning()
      ).id;

      // The creator's own orgless sale.
      const soloItem = await insertContent(creatorId);
      soloSaleId = (
        await insertSale({
          customerId: buyerId,
          contentId: soloItem.id,
          organizationId: null,
          amountPaidCents: 2000,
        })
      ).id;

      // The same creator's content, sold BY AN ORGANISATION: the org's ledger.
      const orgItem = await insertContent(creatorId, orgId);
      orgSaleId = (
        await insertSale({
          customerId: buyerId,
          contentId: orgItem.id,
          organizationId: orgId,
        })
      ).id;

      // Another creator's orgless sale.
      const otherItem = await insertContent(otherCreatorId);
      otherCreatorSaleId = (
        await insertSale({
          customerId: buyerId,
          contentId: otherItem.id,
          organizationId: null,
        })
      ).id;
    });

    it("lists only the creator's own orgless sales, in the org ledger's row shape", async () => {
      const result = await service.listMySales(creatorId, {
        page: 1,
        limit: 20,
      });

      expect(result.items.map((s) => s.id)).toEqual([soloSaleId]);
      expect(result.pagination.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        customerId: buyerId,
        customerEmail: expect.any(String),
        amountPaidCents: 2000,
        organizationFeeCents: 0,
        status: 'completed',
      });
    });

    it("never lists another creator's orgless sale", async () => {
      const mine = await service.listMySales(creatorId, { page: 1, limit: 20 });
      expect(mine.items.map((s) => s.id)).not.toContain(otherCreatorSaleId);

      const theirs = await service.listMySales(otherCreatorId, {
        page: 1,
        limit: 20,
      });
      expect(theirs.items.map((s) => s.id)).toEqual([otherCreatorSaleId]);
    });

    it("keeps an organisation's sale and the solo sale on separate ledgers", async () => {
      const org = await service.listSales(orgId, { page: 1, limit: 20 });
      expect(org.items.map((s) => s.id)).toEqual([orgSaleId]);

      const mine = await service.listMySales(creatorId, { page: 1, limit: 20 });
      expect(mine.items.map((s) => s.id)).not.toContain(orgSaleId);
    });

    it('applies the same filters as the org ledger', async () => {
      const refunded = await service.listMySales(creatorId, {
        page: 1,
        limit: 20,
        status: 'refunded',
      });
      expect(refunded.items).toHaveLength(0);

      const future = await service.listMySales(creatorId, {
        page: 1,
        limit: 20,
        fromDate: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(future.items).toHaveLength(0);
    });

    it('totals the KPIs under the same scope', async () => {
      const stats = await service.getMySalesStats(creatorId, {});
      // 2000 paid, 10% platform fee, no org fee: the creator nets 1800.
      expect(stats).toEqual({
        grossCents: 2000,
        netCents: 1800,
        refundedCents: 0,
        count: 1,
        currency: 'gbp',
      });
    });
  });

  describe('purchase history lists courses too', () => {
    it('lists a course purchase with kind course, and the total counts both kinds', async () => {
      const [creatorId, buyerId] = await seedTestUsers(db, 2);
      const org = takeFirst(
        await db
          .insert(schema.organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      const course = takeFirst(
        await db
          .insert(schema.courses)
          .values({
            organizationId: org.id,
            creatorId,
            slug: createUniqueSlug('gap-course'),
            title: 'The Descent',
            status: 'published',
          })
          .returning()
      );
      const item = await insertContent(creatorId, org.id);

      const contentSale = await insertSale({
        customerId: buyerId,
        contentId: item.id,
        organizationId: org.id,
        createdAt: new Date(Date.now() - 60_000),
      });
      const courseSale = await insertSale({
        customerId: buyerId,
        courseId: course.id,
        organizationId: org.id,
      });

      const firstPage = service.formatPurchasesForClient(
        await service.getPurchaseHistory(buyerId, { page: 1, limit: 1 })
      );

      expect(firstPage.pagination).toEqual({
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      expect(firstPage.items).toEqual([
        {
          id: courseSale.id,
          customerId: buyerId,
          createdAt: expect.any(String),
          kind: 'course',
          contentId: null,
          contentTitle: null,
          courseId: course.id,
          courseTitle: 'The Descent',
          amountCents: 1000,
          status: 'completed',
        },
      ]);

      const secondPage = service.formatPurchasesForClient(
        await service.getPurchaseHistory(buyerId, { page: 2, limit: 1 })
      );
      expect(secondPage.items).toEqual([
        expect.objectContaining({
          id: contentSale.id,
          kind: 'content',
          contentId: item.id,
          contentTitle: item.title,
          courseId: null,
          courseTitle: null,
        }),
      ]);
    });
  });
});
