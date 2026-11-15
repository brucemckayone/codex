/**
 * A payment that lands after its content became unavailable to its buyer
 * (Codex-z1t3c; owner D44 and 2026-11-15: block and refund, a variant line in
 * the existing refund email, no checkout expiry; D54: "match access exactly";
 * D53: a dispute keeps the org-wide streaming block).
 *
 * The defect: completion took only the buyer's advisory lock, and its INSERT
 * only FOR KEY SHARE on the content and its organisation, which never
 * conflicts with the FOR NO KEY UPDATE a delete or access change holds. So a
 * sale completed on content no buyer can watch, and nothing refunded it.
 *
 * The fix, pinned here: completion reads the content and then its
 * organisation FOR SHARE after the item lock (so it waits out a delete in
 * flight), and content that access would refuse its buyer
 * (`contentRefusesBuyers`: deleted, team-only, its organisation deleted,
 * detached) is recorded as a
 * blocked sale (`refund_reason = 'item_unavailable'`): pending, no grant, no
 * slices, refunded in full after the commit under `refund_unavailable_${pi}`,
 * retried by the hourly sweep, kept out of Sales, and never restored by
 * support. A normal sale is unchanged.
 *
 * Real DB. Every row hangs off this file's own organisations and users, and
 * is deleted in afterAll (the sweep is global).
 */

import { randomUUID } from 'node:crypto';
import { createPerRequestDbClient } from '@codex/database';
import {
  content,
  contentAccess,
  courseEnrollments,
  courses,
  entitlements,
  organizations,
  payouts,
  purchases,
  users,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestContentInput,
  createTestMoneyDeps,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PurchaseService } from '../services/purchase-service';

const uid = () => randomUUID().replace(/-/g, '').slice(0, 12);

/** Work started in the background. Its outcome is its value, or its error. */
interface Tracked {
  outcome: Promise<unknown>;
  settled: () => { value: unknown } | undefined;
}

function track(work: Promise<unknown>): Tracked {
  let settled: { value: unknown } | undefined;
  const outcome = work.then(
    (value) => value,
    (error: unknown) => error
  );
  void outcome.then((value) => {
    settled = { value };
  });
  return { outcome, settled: () => settled };
}

async function backendPid(conn: Pick<Database, 'execute'>): Promise<number> {
  const { rows } = await conn.execute(sql`select pg_backend_pid() as pid`);
  return Number((rows[0] as { pid: unknown } | undefined)?.pid);
}

/**
 * A connection of the test's own, as dispute-pause-race's: a pool used one
 * statement at a time, so every statement lands on the backend whose pid is
 * read here. A lock wait on it gives up after 10s, so a regression cannot
 * hang the suite.
 */
async function ownConnection() {
  const { db: conn, cleanup } = createPerRequestDbClient({
    DB_METHOD: process.env.DB_METHOD,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_LOCAL_PROXY: process.env.DATABASE_URL_LOCAL_PROXY,
    NODE_ENV: process.env.NODE_ENV,
  });
  await conn.execute(sql`set lock_timeout = '10s'`);
  return { db: conn, pid: await backendPid(conn), cleanup };
}

/** A refusal Stripe gives for a refund, as the duplicate tests use. */
const refusal = () =>
  Object.assign(new Error('The charge is disputed.'), {
    type: 'StripeInvalidRequestError',
    code: 'charge_disputed',
    statusCode: 400,
  });

/** A mocked `refunds.create` call's (params, options). */
function refundCall(
  stripe: Stripe,
  index: number
): [Stripe.RefundCreateParams | undefined, Stripe.RequestOptions | undefined] {
  const calls = vi.mocked(stripe.refunds.create).mock.calls;
  return (calls[index] ?? []) as unknown as [
    Stripe.RefundCreateParams | undefined,
    Stripe.RequestOptions | undefined,
  ];
}

class RolledBack extends Error {}

describe('a purchase whose content became unavailable before it landed (Codex-z1t3c)', () => {
  let db: Database;
  let creatorId: string;
  let organizationId: string;
  const buyerIds: string[] = [];
  /** Organisations a test deletes or detaches from: never the shared one. */
  const ownOrgIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId] = await seedTestUsers(db, 1);
    organizationId = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: 'Unavailable Item Org',
          slug: createUniqueSlug('z1t3c'),
        })
        .returning()
    ).id;
  });

  afterAll(async () => {
    if (buyerIds.length > 0) {
      const mine = db
        .select({ id: purchases.id })
        .from(purchases)
        .where(inArray(purchases.customerId, buyerIds));
      await db.delete(payouts).where(inArray(payouts.purchaseId, mine));
      await db
        .delete(courseEnrollments)
        .where(inArray(courseEnrollments.userId, buyerIds));
      await db
        .delete(entitlements)
        .where(inArray(entitlements.userId, buyerIds));
      await db
        .delete(contentAccess)
        .where(inArray(contentAccess.userId, buyerIds));
      await db.delete(purchases).where(inArray(purchases.customerId, buyerIds));
    }
    // By creator: detached content has no organisation left to find it by.
    await db.delete(content).where(eq(content.creatorId, creatorId));
    await db.delete(courses).where(eq(courses.organizationId, organizationId));
    await db
      .delete(organizations)
      .where(inArray(organizations.id, [organizationId, ...ownOrgIds]));
    await db.delete(users).where(inArray(users.id, [...buyerIds, creatorId]));
    await teardownTestDatabase();
  });

  function fresh() {
    const stripe = createMockStripe();
    return {
      stripe,
      service: new PurchaseService(
        { db, environment: 'test', ...createTestMoneyDeps() },
        stripe
      ),
    };
  }

  /**
   * A buyer. Alphanumeric, as BetterAuth ids are: the self-heal and the
   * session check parse metadata with the webhook's own schema.
   */
  async function buyer(): Promise<string> {
    const id = `z1t3c${uid()}`;
    await db.insert(users).values({
      id,
      name: 'Unavailable item buyer',
      email: `${id}@example.com`,
      emailVerified: true,
      role: 'customer',
    });
    buyerIds.push(id);
    return id;
  }

  /** The org's content for sale at £15. */
  async function insertContent(
    flags: Partial<typeof content.$inferInsert> = {}
  ) {
    return takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId,
            contentType: 'written',
            title: `Gone ${uid()}`,
            slug: createUniqueSlug('z1t3c'),
            status: 'published',
            publishedAt: new Date(),
            isFree: false,
            isPurchasable: true,
            priceCents: 1500,
            ...flags,
          })
        )
        .returning()
    );
  }

  /** An organisation of the test's own, to delete or detach from. */
  async function ownOrg(): Promise<string> {
    const id = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: 'Unavailable Item Own Org',
          slug: createUniqueSlug('z1t3c-own'),
        })
        .returning()
    ).id;
    ownOrgIds.push(id);
    return id;
  }

  /** The delete, as `OrganizationService.delete` writes it. */
  function deleteOrg(conn: Pick<Database, 'update'>, id: string) {
    return conn
      .update(organizations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(organizations.id, id));
  }

  function complete(
    service: PurchaseService,
    pi: string,
    customerId: string,
    contentId: string,
    stripeChargeId?: string,
    orgId: string = organizationId
  ) {
    return service.completePurchase(pi, {
      customerId,
      contentId,
      organizationId: orgId,
      amountPaidCents: 1500,
      currency: 'gbp',
      stripeChargeId,
    });
  }

  async function rowOf(pi: string) {
    return takeFirst(
      await db
        .select()
        .from(purchases)
        .where(eq(purchases.stripePaymentIntentId, pi))
    );
  }

  /** What the buyer holds for the item: live grants and access rows. */
  async function grantsOf(customerId: string, contentId: string) {
    const [live, access] = await Promise.all([
      db
        .select({ id: entitlements.id })
        .from(entitlements)
        .where(
          and(
            eq(entitlements.userId, customerId),
            eq(entitlements.contentId, contentId),
            isNull(entitlements.revokedAt)
          )
        ),
      db
        .select({ id: contentAccess.id })
        .from(contentAccess)
        .where(
          and(
            eq(contentAccess.userId, customerId),
            eq(contentAccess.contentId, contentId),
            isNull(contentAccess.deletedAt)
          )
        ),
    ]);
    return { entitlements: live.length, access: access.length };
  }

  async function slicesOf(purchaseId: string) {
    return db.select().from(payouts).where(eq(payouts.purchaseId, purchaseId));
  }

  describe('blocked and refunded, never granted', () => {
    it('content deleted before the payment lands: a blocked sale, no grant, no slices, refunded once in full under its own key', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent({ deletedAt: new Date() });
      const customerId = await buyer();
      const pi = `pi_gone_${uid()}`;

      const result = await complete(
        service,
        pi,
        customerId,
        item.id,
        `ch_gone_${uid()}`
      );

      expect(result).toMatchObject({
        status: 'refunded',
        refundReason: 'item_unavailable',
        duplicateOfPurchaseId: null,
        refundAmountCents: 1500,
      });
      expect(result.refundedAt).not.toBeNull();
      expect(result.stripeRefundId).toMatch(/^re_/);
      // Its split is kept for the record, as a duplicate's is.
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(1500);
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      const [params, options] = refundCall(stripe, 0);
      expect(params).toMatchObject({ payment_intent: pi });
      // None of Stripe's reasons fits, so none is sent.
      expect(params).not.toHaveProperty('reason');
      expect(options).toEqual({ idempotencyKey: `refund_unavailable_${pi}` });
      expect(await slicesOf(result.id)).toHaveLength(0);
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });
      // No sale: the org's Sales and its header tiles leave it out.
      const sales = await service.listSales(organizationId, {
        page: 1,
        limit: 100,
      });
      expect(sales.items.map((sale) => sale.id)).not.toContain(result.id);
    });

    it('content made team-only before the payment lands: blocked and refunded the same way', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent({ isTeamOnly: true });
      const customerId = await buyer();
      const pi = `pi_team_${uid()}`;

      const result = await complete(
        service,
        pi,
        customerId,
        item.id,
        `ch_team_${uid()}`
      );

      expect(result).toMatchObject({
        status: 'refunded',
        refundReason: 'item_unavailable',
        refundAmountCents: 1500,
      });
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(refundCall(stripe, 0)[1]).toEqual({
        idempotencyKey: `refund_unavailable_${pi}`,
      });
      expect(await slicesOf(result.id)).toHaveLength(0);
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });
    });

    // Owner D54, "match access exactly": access refuses a buyer the content of
    // a deleted organisation (`isOfDeletedOrg`), so the sale is blocked too.
    it('its organisation deleted before the payment lands: blocked and refunded the same way', async () => {
      const { service, stripe } = fresh();
      const orgId = await ownOrg();
      const item = await insertContent({ organizationId: orgId });
      await deleteOrg(db, orgId);
      const customerId = await buyer();
      const pi = `pi_org_gone_${uid()}`;

      const result = await complete(
        service,
        pi,
        customerId,
        item.id,
        `ch_org_gone_${uid()}`,
        orgId
      );

      expect(result).toMatchObject({
        status: 'refunded',
        refundReason: 'item_unavailable',
        refundAmountCents: 1500,
      });
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(refundCall(stripe, 0)[1]).toEqual({
        idempotencyKey: `refund_unavailable_${pi}`,
      });
      expect(await slicesOf(result.id)).toHaveLength(0);
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });
    });

    // Detached: its organisation_id cleared, which migration 0004's trigger
    // turns into a draft never released, so access refuses every buyer.
    it('detached from its organisation before the payment lands: blocked and refunded the same way', async () => {
      const { service, stripe } = fresh();
      const orgId = await ownOrg();
      const item = await insertContent({ organizationId: orgId });
      await db
        .update(content)
        .set({ organizationId: null, updatedAt: new Date() })
        .where(eq(content.id, item.id));
      // The trigger did fire: what this test means by detached.
      expect(
        takeFirst(
          await db
            .select({
              organizationId: content.organizationId,
              status: content.status,
              publishedAt: content.publishedAt,
            })
            .from(content)
            .where(eq(content.id, item.id))
        )
      ).toEqual({ organizationId: null, status: 'draft', publishedAt: null });
      const customerId = await buyer();
      const pi = `pi_detached_${uid()}`;

      const result = await complete(
        service,
        pi,
        customerId,
        item.id,
        `ch_detached_${uid()}`,
        orgId
      );

      expect(result).toMatchObject({
        status: 'refunded',
        refundReason: 'item_unavailable',
        refundAmountCents: 1500,
      });
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(refundCall(stripe, 0)[1]).toEqual({
        idempotencyKey: `refund_unavailable_${pi}`,
      });
      expect(await slicesOf(result.id)).toHaveLength(0);
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });
    });

    it('a normal completion is unchanged: completed, granted, paid out, listed, and nothing refunded', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent();
      const customerId = await buyer();
      const pi = `pi_sale_${uid()}`;

      const result = await complete(
        service,
        pi,
        customerId,
        item.id,
        `ch_sale_${uid()}`
      );

      expect(result).toMatchObject({
        status: 'completed',
        refundReason: null,
        refundedAt: null,
      });
      expect(stripe.refunds.create).not.toHaveBeenCalled();
      expect((await slicesOf(result.id)).length).toBeGreaterThan(0);
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 1,
        access: 1,
      });
      const sales = await service.listSales(organizationId, {
        page: 1,
        limit: 100,
      });
      expect(sales.items.map((sale) => sale.id)).toContain(result.id);
    });

    it('a replayed webhook asks Stripe nothing more and grants nothing', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent({ deletedAt: new Date() });
      const customerId = await buyer();
      const pi = `pi_replay_${uid()}`;
      const charge = `ch_replay_${uid()}`;

      const first = await complete(service, pi, customerId, item.id, charge);
      const replay = await complete(service, pi, customerId, item.id, charge);

      expect(replay.id).toBe(first.id);
      expect(replay).toMatchObject({
        status: 'refunded',
        refundReason: 'item_unavailable',
      });
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(await slicesOf(first.id)).toHaveLength(0);
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });
    });

    it('the buyer’s success page shows it no longer active, never a purchase still being recorded', async () => {
      const { service, stripe } = fresh();
      // The refund is refused, so the row is still pending.
      vi.mocked(stripe.refunds.create).mockRejectedValueOnce(refusal());
      const item = await insertContent({ deletedAt: new Date() });
      const customerId = await buyer();
      const pi = `pi_page_${uid()}`;
      await expect(
        complete(service, pi, customerId, item.id)
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      const sessionId = `cs_page_${uid()}`;
      stripe.checkout.sessions.retrieve = vi.fn().mockResolvedValue({
        id: sessionId,
        status: 'complete',
        payment_status: 'paid',
        payment_intent: pi,
        metadata: { customerId, contentId: item.id, organizationId },
      }) as never;

      const verified = await service.verifyCheckoutSession(
        sessionId,
        customerId
      );

      expect((await rowOf(pi)).status).toBe('pending');
      expect(verified.state).toBe('refunded');
      expect(verified.duplicatePayment).toBeUndefined();
    });
  });

  describe('a delete in flight while the payment lands', () => {
    it('the completion waits on the delete’s row lock, then reads the delete and blocks the sale', async () => {
      const { stripe } = fresh();
      const item = await insertContent();
      const customerId = await buyer();
      const pi = `pi_race_${uid()}`;
      const conn = await ownConnection();
      let work = track(Promise.resolve());
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '10s'`);
          // The delete, as ContentService.delete writes it: its UPDATE holds
          // the row FOR NO KEY UPDATE until it commits.
          await tx
            .update(content)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(eq(content.id, item.id));
          const holder = await backendPid(tx);
          work = track(
            complete(
              new PurchaseService(
                { db: conn.db, environment: 'test', ...createTestMoneyDeps() },
                stripe
              ),
              pi,
              customerId,
              item.id,
              `ch_race_${uid()}`
            )
          );
          // Proof of the wait: blocked by this transaction, on `content`.
          await untilWaiting(conn.pid, holder, 'content', work);
        });

        expect(await work.outcome).toMatchObject({
          status: 'refunded',
          refundReason: 'item_unavailable',
        });
      } finally {
        await work.outcome;
        await conn.cleanup();
      }
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });
    });

    it('a delete that rolls back: the completion still waits, then completes as a sale', async () => {
      const { stripe } = fresh();
      const item = await insertContent();
      const customerId = await buyer();
      const pi = `pi_race_back_${uid()}`;
      const conn = await ownConnection();
      let work = track(Promise.resolve());
      try {
        await expect(
          db.transaction(async (tx) => {
            await tx.execute(sql`set local lock_timeout = '10s'`);
            await tx
              .update(content)
              .set({ deletedAt: new Date(), updatedAt: new Date() })
              .where(eq(content.id, item.id));
            const holder = await backendPid(tx);
            work = track(
              complete(
                new PurchaseService(
                  {
                    db: conn.db,
                    environment: 'test',
                    ...createTestMoneyDeps(),
                  },
                  stripe
                ),
                pi,
                customerId,
                item.id
              )
            );
            await untilWaiting(conn.pid, holder, 'content', work);
            throw new RolledBack('the delete is abandoned');
          })
        ).rejects.toBeInstanceOf(RolledBack);

        expect(await work.outcome).toMatchObject({
          status: 'completed',
          refundReason: null,
        });
      } finally {
        await work.outcome;
        await conn.cleanup();
      }
      expect(stripe.refunds.create).not.toHaveBeenCalled();
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 1,
        access: 1,
      });
    });

    it('an organisation delete in flight: the completion waits on the organisation’s row lock, then reads the delete and blocks the sale', async () => {
      const { stripe } = fresh();
      const orgId = await ownOrg();
      const item = await insertContent({ organizationId: orgId });
      const customerId = await buyer();
      const pi = `pi_org_race_${uid()}`;
      const conn = await ownConnection();
      let work = track(Promise.resolve());
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '10s'`);
          // Its UPDATE holds the organisation row FOR NO KEY UPDATE until it
          // commits; the purchase INSERT's foreign-key FOR KEY SHARE alone
          // would never wait for it.
          await deleteOrg(tx, orgId);
          const holder = await backendPid(tx);
          work = track(
            complete(
              new PurchaseService(
                { db: conn.db, environment: 'test', ...createTestMoneyDeps() },
                stripe
              ),
              pi,
              customerId,
              item.id,
              `ch_org_race_${uid()}`,
              orgId
            )
          );
          // Proof of the wait: blocked by this transaction, on
          // `organizations`, the content row's own lock already held.
          await untilWaiting(conn.pid, holder, 'organizations', work);
        });

        expect(await work.outcome).toMatchObject({
          status: 'refunded',
          refundReason: 'item_unavailable',
        });
      } finally {
        await work.outcome;
        await conn.cleanup();
      }
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });
    });
  });

  // Owner D53: a dispute on a blocked sale keeps today's org-wide streaming
  // block. The realistic order: the blocked sale's refund is refused because
  // the charge is disputed, and then the dispute's own webhook lands.
  describe('a dispute on a blocked sale', () => {
    it('ends access, so the webhook writes the org-wide streaming block, and keeps the marker', async () => {
      const { service, stripe } = fresh();
      vi.mocked(stripe.refunds.create).mockRejectedValueOnce(refusal());
      const item = await insertContent({ deletedAt: new Date() });
      const customerId = await buyer();
      const pi = `pi_dispute_${uid()}`;
      await expect(
        complete(service, pi, customerId, item.id)
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

      const disputed = await service.processDispute(pi, {
        stripeDisputeId: `dp_blocked_${uid()}`,
        disputeReason: 'product_unacceptable',
      });

      expect(disputed).toEqual({
        userId: customerId,
        orgId: organizationId,
        accessEnded: true,
      });
      const row = await rowOf(pi);
      expect(row.disputedAt).not.toBeNull();
      expect(row).toMatchObject({
        status: 'pending',
        refundReason: 'item_unavailable',
      });
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });
    });
  });

  describe('a refund Stripe refuses', () => {
    it('is a retryable failure; the row stays pending and owed; the hourly sweep settles it under the same key', async () => {
      const { service, stripe } = fresh();
      vi.mocked(stripe.refunds.create).mockRejectedValueOnce(refusal());
      const item = await insertContent({ isTeamOnly: true });
      const customerId = await buyer();
      const pi = `pi_owed_${uid()}`;

      await expect(
        complete(service, pi, customerId, item.id)
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      expect(await rowOf(pi)).toMatchObject({
        status: 'pending',
        refundReason: 'item_unavailable',
        refundedAt: null,
        refundAmountCents: null,
      });
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });

      // Within the hour Stripe is still redelivering: not the sweep's.
      const early = await service.settleOwedDuplicates({
        olderThanMs: 60 * 60 * 1000,
        limit: 1000,
      });
      expect(early.stillOwed.map((o) => o.stripePaymentIntentId)).not.toContain(
        pi
      );

      // Past it, Stripe still refusing: reported, still owed.
      vi.mocked(stripe.refunds.create).mockRejectedValue(refusal());
      const refused = await service.settleOwedDuplicates({
        olderThanMs: 0,
        limit: 1000,
      });
      expect(refused.stillOwed.map((o) => o.stripePaymentIntentId)).toContain(
        pi
      );
      expect((await rowOf(pi)).status).toBe('pending');

      // Stripe accepts: refunded, and no longer owed.
      vi.mocked(stripe.refunds.create).mockResolvedValue({
        id: `re_sweep_${uid()}`,
      } as never);
      const swept = await service.settleOwedDuplicates({
        olderThanMs: 0,
        limit: 1000,
      });
      expect(swept.stillOwed.map((o) => o.stripePaymentIntentId)).not.toContain(
        pi
      );
      expect(await rowOf(pi)).toMatchObject({
        status: 'refunded',
        refundReason: 'item_unavailable',
        refundAmountCents: 1500,
      });
      // Every ask for this payment, refused or not, under its one key.
      const keys = vi
        .mocked(stripe.refunds.create)
        .mock.calls.map((_, index) => refundCall(stripe, index))
        .filter(([params]) => params?.payment_intent === pi)
        .map(([, options]) => options?.idempotencyKey);
      expect(keys.length).toBeGreaterThanOrEqual(3);
      expect(new Set(keys)).toEqual(new Set([`refund_unavailable_${pi}`]));
    });

    it('a refund made elsewhere while it is owed is recorded with the marker kept, and revokes nothing the buyer holds', async () => {
      const { service, stripe } = fresh();
      vi.mocked(stripe.refunds.create).mockRejectedValueOnce(refusal());
      const item = await insertContent({ deletedAt: new Date() });
      const customerId = await buyer();
      // The buyer's own grant of the item, from before: not the sale's.
      await db.insert(contentAccess).values({
        userId: customerId,
        contentId: item.id,
        organizationId,
        accessType: 'complimentary',
      });
      const pi = `pi_elsewhere_${uid()}`;
      await expect(
        complete(service, pi, customerId, item.id)
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

      // Support refunds it in the Stripe Dashboard: its charge.refunded,
      // with Stripe's reason.
      const result = await service.processRefund(pi, {
        charge: { id: `ch_elsewhere_${uid()}`, amountCents: 1500 },
        refundAmountCents: 1500,
        stripeRefundId: `re_elsewhere_${uid()}`,
        refundReason: 'requested_by_customer',
      });

      expect(result).toMatchObject({
        userId: customerId,
        itemUnavailable: true,
        duplicatePayment: false,
        lateWinKeptThrough: null,
      });
      expect(await rowOf(pi)).toMatchObject({
        status: 'refunded',
        refundReason: 'item_unavailable',
        refundAmountCents: 1500,
      });
      expect((await grantsOf(customerId, item.id)).access).toBe(1);
    });
  });

  describe('charge.refunded before the checkout lands (the self-heal)', () => {
    function sessionFor(stripe: Stripe, customerId: string, contentId: string) {
      stripe.checkout.sessions.list = vi.fn().mockResolvedValue({
        data: [
          {
            id: `cs_heal_${uid()}`,
            amount_total: 1500,
            currency: 'gbp',
            created: Math.floor(Date.now() / 1000),
            metadata: { customerId, contentId, organizationId },
          },
        ],
      }) as never;
    }

    it('refunded in full: rebuilt as a refunded blocked sale with the marker, granting nothing; the checkout then asks Stripe nothing', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent({ deletedAt: new Date() });
      const customerId = await buyer();
      const pi = `pi_heal_${uid()}`;
      sessionFor(stripe, customerId, item.id);

      const result = await service.processRefund(pi, {
        charge: { id: `ch_heal_${uid()}`, amountCents: 1500 },
        refundAmountCents: 1500,
        refundReason: 'requested_by_customer',
      });

      expect(result).toMatchObject({
        itemUnavailable: true,
        duplicatePayment: false,
      });
      expect(await rowOf(pi)).toMatchObject({
        status: 'refunded',
        refundReason: 'item_unavailable',
        duplicateOfPurchaseId: null,
      });
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });

      // The checkout webhook lands after: the row stands, nothing more.
      const landed = await complete(service, pi, customerId, item.id);
      expect(landed.status).toBe('refunded');
      expect(stripe.refunds.create).not.toHaveBeenCalled();
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });
    });

    it('refunded in part: rebuilt pending with the marker, granting nothing; the checkout then refunds the rest', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent({ isTeamOnly: true });
      const customerId = await buyer();
      const pi = `pi_heal_part_${uid()}`;
      sessionFor(stripe, customerId, item.id);

      await service.processRefund(pi, {
        charge: { id: `ch_heal_part_${uid()}`, amountCents: 1500 },
        refundAmountCents: 500,
      });

      expect(await rowOf(pi)).toMatchObject({
        status: 'pending',
        refundReason: 'item_unavailable',
      });
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });

      const landed = await complete(service, pi, customerId, item.id);
      expect(landed).toMatchObject({
        status: 'refunded',
        refundReason: 'item_unavailable',
      });
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(refundCall(stripe, 0)[1]).toEqual({
        idempotencyKey: `refund_unavailable_${pi}`,
      });
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });
    });
  });

  describe('support settling a failed refund of a blocked sale', () => {
    it('never gives access back: the reason is `unavailable`, the row stays refunded with its marker', async () => {
      const { service } = fresh();
      const item = await insertContent({ deletedAt: new Date() });
      const customerId = await buyer();
      const pi = `pi_settle_${uid()}`;
      const chargeId = `ch_settle_${uid()}`;
      const blocked = await complete(service, pi, customerId, item.id);
      expect(blocked.status).toBe('refunded');

      expect(await service.failedRefundRestoreBlock(blocked.id, chargeId)).toBe(
        'unavailable'
      );
      const settled = await db.transaction((tx) =>
        service.restoreAfterFailedRefund(tx, blocked.id, chargeId)
      );

      expect(settled).toMatchObject({ restored: false, reason: 'unavailable' });
      expect(await rowOf(pi)).toMatchObject({
        status: 'refunded',
        refundReason: 'item_unavailable',
      });
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });
    });
  });

  // The course twin has no such gap: no code writes `courses.deleted_at`, and
  // a course's buyers keep it unpublished or off sale (Codex-yo4px), so a
  // course archived while Checkout is open is still a sale its buyer can use.
  describe('the course twin', () => {
    it('a course taken off sale while Checkout is open still completes, granting the course', async () => {
      const { service, stripe } = fresh();
      const course = takeFirst(
        await db
          .insert(courses)
          .values({
            organizationId,
            creatorId,
            slug: createUniqueSlug('z1t3c-course'),
            title: 'Archived while paying',
            status: 'archived',
            offSaleAt: new Date(),
            priceCents: 4999,
          })
          .returning()
      );
      const customerId = await buyer();

      const result = await service.completeCoursePurchase(
        `pi_course_${uid()}`,
        {
          customerId,
          courseId: course.id,
          amountPaidCents: 4999,
          currency: 'gbp',
        }
      );

      expect(result).toMatchObject({ status: 'completed', refundReason: null });
      expect(stripe.refunds.create).not.toHaveBeenCalled();
      const live = await db
        .select({ id: entitlements.id })
        .from(entitlements)
        .where(
          and(
            eq(entitlements.userId, customerId),
            eq(entitlements.courseId, course.id),
            eq(entitlements.source, 'course_purchase'),
            isNull(entitlements.revokedAt)
          )
        );
      expect(live).toHaveLength(1);
    });
  });

  /**
   * Resolve once backend `waiter` waits, in a statement on `table`, on a lock
   * backend `holder` holds. Both are this test's own connections, so a peer
   * session cannot satisfy it. Throws if `work`, which runs on `waiter`,
   * settles first: it never waited.
   */
  async function untilWaiting(
    waiter: number,
    holder: number,
    table: string,
    work: Tracked
  ): Promise<void> {
    for (let attempt = 0; attempt < 250; attempt++) {
      const early = work.settled();
      if (early) {
        throw new Error(`settled before it waited on ${table}`, {
          cause: early.value,
        });
      }
      const { rows } = await db.execute(
        sql`select 1 from pg_stat_activity
            where pid = ${waiter}::int
              and ${holder}::int = any(pg_blocking_pids(pid))
              and query ilike ${`%"${table}"%`}`
      );
      if (rows.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`never waited on ${table}`);
  }
});
