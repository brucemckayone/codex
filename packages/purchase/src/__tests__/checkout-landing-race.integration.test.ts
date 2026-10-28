/**
 * The success page and the webhook complete the SAME checkout at once
 * (Codex-2hxff.22; owner decision 2026-10-26, "Unlock on arrival").
 *
 * The success page now records the purchase the moment the buyer lands, with
 * the same completion the `checkout.session.completed` webhook runs, and the
 * webhook stays the backstop. Stripe waits up to 10 s for the webhook before
 * it redirects, so the two often run together. Each runs its own
 * PurchaseService with its own Stripe client, as in production (the webhook's
 * verified client; the route's registry client), and passes its own payment
 * time (the event's `created`; the charge's `created`).
 *
 * What must come out once: the purchase, its access, each payouts ledger row,
 * each transfer, and the receipt claim. Two Stripe mocks, not one, so a second
 * transfer for a slice would be COUNTED rather than collapsed by a shared
 * idempotency key: only the ledger's reservation may stop it.
 *
 * Real Postgres: the guards are a lock, unique indexes and atomic claims.
 * Token-tagged rows, deleted in afterAll (the local test DB is shared).
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  contentAccess,
  courseEnrollments,
  courses,
  entitlements,
  organizationOwnershipPeriods,
  organizations,
  payouts,
  purchases,
  stripeConnectAccounts,
  users,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestConnectAccountInput,
  createTestContentInput,
  createTestMoneyDeps,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setTestOrganisationPayee,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PurchaseService } from '../services/purchase-service';

const PRICE = 1000;
const token = randomUUID().slice(0, 8);

describe('The success page and the webhook complete one checkout at once (Codex-2hxff.22)', () => {
  let db: Database;
  let buyerId: string;
  let creatorId: string;
  let ownerId: string;
  let orgId: string;
  const contentIds: string[] = [];
  const courseIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [buyerId, creatorId, ownerId] = (await seedTestUsers(db, 3)) as [
      string,
      string,
      string,
    ];
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: `Landing Race Org ${token}`,
          slug: createUniqueSlug(`landing-race-${token}`),
        })
        .returning()
    ).id;
    await setTestOrganisationPayee(db, orgId, ownerId);
    await db
      .insert(stripeConnectAccounts)
      .values([
        createTestConnectAccountInput(null, creatorId),
        createTestConnectAccountInput(null, ownerId),
      ]);
    // Two connections open before the first race. Otherwise the second
    // caller waits for a new one, the first commits meanwhile, and the second
    // finds its row before it ever reaches the lock: no race at all.
    await Promise.all([
      db.transaction((tx) => tx.execute(sql`SELECT pg_sleep(0.05)`)),
      db.transaction((tx) => tx.execute(sql`SELECT pg_sleep(0.05)`)),
    ]);
  });

  // Payout rows feed global drains: never leave them behind.
  afterAll(async () => {
    const bought = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.customerId, buyerId));
    const purchaseIds = bought.map((row) => row.id);
    if (purchaseIds.length > 0) {
      await db.delete(payouts).where(inArray(payouts.purchaseId, purchaseIds));
    }
    await db.delete(entitlements).where(eq(entitlements.userId, buyerId));
    await db
      .delete(courseEnrollments)
      .where(eq(courseEnrollments.userId, buyerId));
    await db.delete(contentAccess).where(eq(contentAccess.userId, buyerId));
    await db.delete(purchases).where(eq(purchases.customerId, buyerId));
    if (courseIds.length > 0) {
      await db.delete(courses).where(inArray(courses.id, courseIds));
    }
    if (contentIds.length > 0) {
      await db.delete(content).where(inArray(content.id, contentIds));
    }
    await db
      .delete(stripeConnectAccounts)
      .where(inArray(stripeConnectAccounts.userId, [creatorId, ownerId]));
    await db
      .delete(organizationOwnershipPeriods)
      .where(eq(organizationOwnershipPeriods.organizationId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db
      .delete(users)
      .where(inArray(users.id, [buyerId, creatorId, ownerId]));
    await teardownTestDatabase();
  });

  /** One paid checkout of a new item, completed by whichever caller asks. */
  async function sale(kind: 'content' | 'course') {
    const tag = randomUUID().slice(0, 8);
    const paymentIntentId = `pi_landing_${token}_${tag}`;
    const chargeId = `ch_landing_${token}_${tag}`;
    const offerAt = new Date(Date.now() - 60_000);
    if (kind === 'content') {
      const item = takeFirst(
        await db
          .insert(content)
          .values(
            createTestContentInput(creatorId, {
              organizationId: orgId,
              contentType: 'written',
              slug: createUniqueSlug(`landing-race-${token}`),
            })
          )
          .returning()
      );
      contentIds.push(item.id);
      return {
        paymentIntentId,
        chargeId,
        itemId: item.id,
        complete: (service: PurchaseService, paidAt: Date) =>
          service.completePurchase(paymentIntentId, {
            contentId: item.id,
            customerId: buyerId,
            organizationId: orgId,
            amountPaidCents: PRICE,
            currency: 'gbp',
            stripeChargeId: chargeId,
            stripeApplicationFeeCents: null,
            paidAt,
            offerAt,
          }),
      };
    }
    const course = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId: orgId,
          creatorId,
          slug: createUniqueSlug(`landing-race-course-${token}`),
          title: 'Landing race course',
          status: 'published',
          priceCents: PRICE,
        })
        .returning()
    );
    courseIds.push(course.id);
    return {
      paymentIntentId,
      chargeId,
      itemId: course.id,
      complete: (service: PurchaseService, paidAt: Date) =>
        service.completeCoursePurchase(paymentIntentId, {
          courseId: course.id,
          customerId: buyerId,
          amountPaidCents: PRICE,
          currency: 'gbp',
          stripeChargeId: chargeId,
          stripeApplicationFeeCents: null,
          paidAt,
          offerAt,
        }),
    };
  }

  /** Every transfer either caller asked Stripe for, by idempotency key. */
  function transferKeys(...clients: Stripe[]): string[] {
    return clients.flatMap((client) =>
      vi
        .mocked(client.transfers.create)
        .mock.calls.map(
          (call) =>
            (call[1] as Stripe.RequestOptions | undefined)?.idempotencyKey ??
            '(no key)'
        )
    );
  }

  async function accessRows(kind: 'content' | 'course', itemId: string) {
    if (kind === 'content') {
      return db
        .select()
        .from(contentAccess)
        .where(
          and(
            eq(contentAccess.userId, buyerId),
            eq(contentAccess.contentId, itemId)
          )
        );
    }
    return db
      .select()
      .from(entitlements)
      .where(
        and(eq(entitlements.userId, buyerId), eq(entitlements.courseId, itemId))
      );
  }

  it.each([
    'content',
    'course',
  ] as const)('a %s checkout: one purchase, one access grant, one set of ledger rows, one transfer per slice, one receipt', async (kind) => {
    const sold = await sale(kind);
    const webhookStripe = createMockStripe();
    const pageStripe = createMockStripe();
    const webhook = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      webhookStripe
    );
    const page = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      pageStripe
    );
    const eventCreated = new Date(Date.now() - 2_000);
    const chargeCreated = new Date(Date.now() - 3_000);

    const [fromWebhook, fromPage] = await Promise.all([
      sold.complete(webhook, eventCreated),
      sold.complete(page, chargeCreated),
    ]);

    // One purchase, which both callers end on.
    expect(fromWebhook.id).toBe(fromPage.id);
    const rows = await db
      .select()
      .from(purchases)
      .where(eq(purchases.stripePaymentIntentId, sold.paymentIntentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('completed');
    // Whichever wrote the row fixed the sale's time.
    expect([eventCreated.getTime(), chargeCreated.getTime()]).toContain(
      rows[0]?.purchasedAt?.getTime()
    );

    // One access grant.
    expect(await accessRows(kind, sold.itemId)).toHaveLength(1);

    // One set of ledger rows: each slice once.
    const slices = await db
      .select({ payoutType: payouts.payoutType })
      .from(payouts)
      .where(eq(payouts.stripeChargeId, sold.chargeId));
    expect(slices.map((slice) => slice.payoutType).sort()).toEqual([
      'creator_payout',
      'organization_fee',
      'platform_fee',
    ]);

    // One transfer per payee slice, across BOTH Stripe clients.
    const keys = transferKeys(webhookStripe, pageStripe);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);

    // Neither saw a duplicate payment, so nothing was refunded.
    expect(webhookStripe.refunds.create).not.toHaveBeenCalled();
    expect(pageStripe.refunds.create).not.toHaveBeenCalled();

    // One receipt claim, whichever asks first.
    const claims = await Promise.all([
      webhook.claimReceipt(fromWebhook.id),
      page.claimReceipt(fromPage.id),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);

    // The page's next read finds it recorded, and unlocks.
    const { result, recorded } = await page.readCheckoutSession(
      {
        id: `cs_landing_${token}`,
        status: 'complete',
        payment_status: 'paid',
        payment_intent: sold.paymentIntentId,
        metadata: { customerId: buyerId },
      } as unknown as Stripe.Checkout.Session,
      buyerId
    );
    expect(recorded).toBe(true);
    expect(result.state).toBe('unlocked');
  });
});
