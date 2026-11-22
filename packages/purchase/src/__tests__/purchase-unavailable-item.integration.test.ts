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
 * slices, refunded in full after the commit under
 * `refund_unavailable_${pi}_${amount}` (what is owed, owner D73),
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
  disputes,
  entitlements,
  organizations,
  payouts,
  purchases,
  refunds,
  users,
} from '@codex/database/schema';
import { ServiceUnavailableError } from '@codex/service-errors';
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
import { findShortLosses } from '../services/short-loss';

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

/** The messages a service logs at error, as they are logged. */
function alertsOf(service: PurchaseService) {
  const { obs } = service as unknown as {
    obs: { error: (message: string, meta?: object) => void };
  };
  const spy = vi.spyOn(obs, 'error');
  return () => spy.mock.calls.map(([message]) => message);
}

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

/**
 * The PaymentIntent's one charge, as `latest_charge` names it, and one
 * succeeded refund of it on Stripe's list: what a blocked refund's sync reads
 * (`blockedRefundOwed`, owner D73).
 */
function chargesItsRefund(
  stripe: Stripe,
  paymentIntentId: string,
  chargeId: string,
  refundId: string,
  amountCents: number
) {
  vi.mocked(stripe.paymentIntents.retrieve).mockImplementation((async (
    id: string
  ) => ({
    id,
    latest_charge: id === paymentIntentId ? chargeId : null,
  })) as never);
  vi.mocked(stripe.refunds.list).mockImplementation((async (params: {
    charge?: string;
  }) => ({
    object: 'list',
    data:
      params.charge === chargeId
        ? [
            {
              id: refundId,
              object: 'refund',
              amount: amountCents,
              charge: chargeId,
              currency: 'gbp',
              status: 'succeeded',
              reason: 'requested_by_customer',
              failure_reason: null,
              created: Math.floor(Date.now() / 1000),
              metadata: {},
            },
          ]
        : [],
    has_more: false,
  })) as never);
}

class RolledBack extends Error {}

describe('a purchase whose item became unavailable before it landed (Codex-z1t3c)', () => {
  let db: Database;
  let creatorId: string;
  let organizationId: string;
  const buyerIds: string[] = [];
  /** Organisations a test deletes or detaches from: never the shared one. */
  const ownOrgIds: string[] = [];
  /** Refunds recorded with no purchase, which the purchase cleanup can't find. */
  const unlinkedRefundIds: string[] = [];

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
      // A dispute and a refund name their purchase (ON DELETE RESTRICT).
      await db.delete(disputes).where(inArray(disputes.purchaseId, mine));
      await db.delete(refunds).where(inArray(refunds.purchaseId, mine));
      if (unlinkedRefundIds.length > 0) {
        await db
          .delete(refunds)
          .where(inArray(refunds.stripeRefundId, unlinkedRefundIds));
      }
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
    await db.delete(courses).where(eq(courses.creatorId, creatorId));
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
      // What is owed, all of it: nothing was refunded yet (owner D73).
      expect(params).toMatchObject({ payment_intent: pi, amount: 1500 });
      // None of Stripe's reasons fits, so none is sent.
      expect(params).not.toHaveProperty('reason');
      expect(options).toEqual({
        idempotencyKey: `refund_unavailable_${pi}_1500`,
      });
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
        idempotencyKey: `refund_unavailable_${pi}_1500`,
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
        idempotencyKey: `refund_unavailable_${pi}_1500`,
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
        idempotencyKey: `refund_unavailable_${pi}_1500`,
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

    // The wait is bounded (5 s): a writer stuck on the row must not stall the
    // webhook while it holds the buyer's advisory lock. The connection's own
    // lock_timeout is 10 s, so giving up inside 10 s is the completion's 5 s.
    it('a delete held past the 5 s lock timeout: the completion gives up with a retryable 503 and writes nothing; the redelivery after the delete is blocked', async () => {
      const { stripe } = fresh();
      const item = await insertContent();
      const customerId = await buyer();
      const pi = `pi_race_timeout_${uid()}`;
      const conn = await ownConnection();
      let work = track(Promise.resolve());
      let waitedMs = 0;
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '10s'`);
          await tx
            .update(content)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(eq(content.id, item.id));
          const holder = await backendPid(tx);
          const startedAt = Date.now();
          work = track(
            complete(
              new PurchaseService(
                { db: conn.db, environment: 'test', ...createTestMoneyDeps() },
                stripe
              ),
              pi,
              customerId,
              item.id,
              `ch_race_timeout_${uid()}`
            )
          );
          await untilWaiting(conn.pid, holder, 'content', work);
          // Held until the completion gives up, then committed.
          const failure = await work.outcome;
          waitedMs = Date.now() - startedAt;
          expect(failure).toBeInstanceOf(ServiceUnavailableError);
          // Neutral: the wait may be any row the payment needed, and the
          // retry may still block and refund it.
          expect(failure).toMatchObject({
            code: 'SERVICE_UNAVAILABLE',
            message:
              'Another change held a row this payment needed; the payment is retried',
          });
        });
      } finally {
        await work.outcome;
        await conn.cleanup();
      }
      expect(waitedMs).toBeGreaterThanOrEqual(4500);
      expect(waitedMs).toBeLessThan(9500);
      expect(
        await db
          .select({ id: purchases.id })
          .from(purchases)
          .where(eq(purchases.stripePaymentIntentId, pi))
      ).toEqual([]);
      expect(stripe.refunds.create).not.toHaveBeenCalled();

      // Stripe redelivers once the delete has committed: a blocked sale.
      expect(
        await complete(
          new PurchaseService(
            { db, environment: 'test', ...createTestMoneyDeps() },
            stripe
          ),
          pi,
          customerId,
          item.id
        )
      ).toMatchObject({ status: 'refunded', refundReason: 'item_unavailable' });
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
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

  // Owner D56, widened to duplicates by D57: the owed-refund sweep leaves a
  // blocked payment to a chargeback while it is OPEN (Stripe refuses that
  // refund), read from the disputes table, and only then. A loss refunds the
  // row; any other end lets the next sweep refund it, `prevented` and an end
  // never recorded included, so nothing is held forever. One held past
  // Stripe's dispute lifecycle is alerted. A loss for less than the payment
  // leaves the rest owed, and support is alerted to refund it (owner D59).
  describe.each([
    { kind: 'unavailable' as const, key: 'refund_unavailable_' },
    { kind: 'duplicate' as const, key: 'refund_duplicate_' },
  ])('a chargeback on a blocked payment ($kind)', ({ kind, key }) => {
    const HELD_ALERT =
      'Blocked refunds still held by a chargeback after 120 days: check the dispute in Stripe, then refund them by hand';
    // Stripe won't refund a charged-back payment, so support pays the rest
    // another way and marks it on the charge page (owner D60, D61).
    const SHORT_ALERT =
      'A lost chargeback refunded only part of a blocked payment: pay the rest another way, then mark it paid on the support charge page';
    const SHORT_REPORT =
      'Blocked payments a lost chargeback refunded only in part: pay the rest another way, then mark it paid on the support charge page';
    const OWED_AGAIN_REPORT =
      'Blocked payments owed again after a late win: pay it another way, then mark it paid on the support charge page';

    /**
     * Each payment's one charge, by its PaymentIntent (review r7): the
     * completion, its refunds and its chargeback all name it, as Stripe's
     * events do, since a PaymentIntent has one charge.
     */
    const chargeOfPayment = new Map<string, string>();
    function chargeOf(pi: string): string {
      const chargeId = chargeOfPayment.get(pi);
      if (!chargeId) throw new Error(`no charge for ${pi}`);
      return chargeId;
    }

    /**
     * A blocked payment of this kind whose refund Stripe refused: owed.
     * `beforePurchase` runs once its PaymentIntent is known, before the
     * purchase lands; `stripeChargeId` is its one charge (`chargeOf`), its
     * own unless given, which the completion names unless it `landsUnnamed`.
     */
    async function owedBlocked(
      service: PurchaseService,
      stripe: Stripe,
      options: {
        stripeChargeId?: string;
        landsUnnamed?: boolean;
        beforePurchase?: (pi: string) => Promise<unknown>;
      } = {}
    ) {
      const item = await insertContent(
        kind === 'unavailable' ? { deletedAt: new Date() } : {}
      );
      const customerId = await buyer();
      if (kind === 'duplicate') {
        await complete(service, `pi_first_${uid()}`, customerId, item.id);
      }
      const pi = `pi_chargeback_${kind}_${uid()}`;
      const chargeId = options.stripeChargeId ?? `ch_chargeback_${uid()}`;
      chargeOfPayment.set(pi, chargeId);
      await options.beforePurchase?.(pi);
      vi.mocked(stripe.refunds.create).mockRejectedValueOnce(refusal());
      await expect(
        complete(
          service,
          pi,
          customerId,
          item.id,
          options.landsUnnamed ? undefined : chargeId
        )
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      expect((await rowOf(pi)).status).toBe('pending');
      const asksFor = () =>
        vi
          .mocked(stripe.refunds.create)
          .mock.calls.map((_, index) => refundCall(stripe, index))
          .filter(([params]) => params?.payment_intent === pi);
      return { item, customerId, pi, chargeId, asksFor };
    }

    /**
     * The dispute's record at `status`, on the payment's charge, as the
     * webhook writes it. The loss is then applied with the recorded amount,
     * as the webhook passes it.
     */
    function recordChargeback(
      service: PurchaseService,
      pi: string,
      disputeId: string,
      status: string,
      { openedAt = new Date(), amountCents = 1500 } = {}
    ) {
      return service.recordDispute({
        stripeDisputeId: disputeId,
        stripeChargeId: chargeOf(pi),
        paymentIntentId: pi,
        amountCents,
        currency: 'gbp',
        status,
        reason: 'fraudulent',
        stripeCreatedAt: openedAt,
      });
    }

    /** A chargeback opened on it: recorded, then the purchase paused. */
    async function openChargeback(
      service: PurchaseService,
      pi: string,
      openedAt?: Date
    ) {
      const disputeId = `dp_${kind}_${uid()}`;
      await recordChargeback(service, pi, disputeId, 'needs_response', {
        openedAt,
      });
      await service.processDispute(pi, { stripeDisputeId: disputeId });
      return disputeId;
    }

    const sweep = (service: PurchaseService) =>
      service.settleOwedDuplicates({ olderThanMs: 0, limit: 1000 });

    /** The service's error lines. */
    function errorsOf(service: PurchaseService) {
      const { obs } = service as unknown as {
        obs: { error: (message: string, meta?: object) => void };
      };
      return vi.spyOn(obs, 'error');
    }

    /** A refund Stripe made of the payment, on its charge, as the refund webhook records it. */
    function recordPartRefund(
      service: PurchaseService,
      pi: string,
      amountCents: number
    ) {
      return service.recordRefund({
        stripeRefundId: `re_part_${uid()}`,
        stripeChargeId: chargeOf(pi),
        paymentIntentId: pi,
        amountCents,
        currency: 'gbp',
        status: 'succeeded',
        reason: null,
        failureReason: null,
        stripeCreatedAt: new Date(),
      });
    }

    /** What the sweep's report line names, one entry per payment. */
    function shortReported(
      errors: ReturnType<typeof errorsOf>,
      line: string = SHORT_REPORT
    ) {
      return errors.mock.calls
        .filter(([message]) => message === line)
        .flatMap(
          ([, meta]) => (meta as { owed: Array<Record<string, unknown>> }).owed
        );
    }

    async function disputeOf(stripeDisputeId: string) {
      return takeFirst(
        await db
          .select()
          .from(disputes)
          .where(eq(disputes.stripeDisputeId, stripeDisputeId))
      );
    }

    it('while the chargeback is open, the sweep skips it: Stripe is not asked and nothing is alerted; once won, the next sweep refunds it', async () => {
      const { service, stripe } = fresh();
      const { pi, asksFor } = await owedBlocked(service, stripe);
      const disputeId = await openChargeback(service, pi);

      vi.mocked(stripe.refunds.create).mockRejectedValue(refusal());
      const held = await sweep(service);
      expect(held.stillOwed.map((o) => o.stripePaymentIntentId)).not.toContain(
        pi
      );
      // Only the completion's own refusal: the sweep asked nothing.
      expect(asksFor()).toHaveLength(1);
      expect((await rowOf(pi)).status).toBe('pending');

      await recordChargeback(service, pi, disputeId, 'won');
      await service.restoreDisputedPurchase(pi);
      vi.mocked(stripe.refunds.create).mockResolvedValue({
        id: `re_won_${uid()}`,
      } as never);
      await sweep(service);

      const asks = asksFor();
      expect(asks).toHaveLength(2);
      expect(asks[1]?.[1]).toEqual({ idempotencyKey: `${key}${pi}_1500` });
      expect((await rowOf(pi)).status).toBe('refunded');
    });

    // The MEDIUM of review r2: these ends never clear `disputed_at` (only a
    // win does) and never refund the row (only a loss does), so a skip keyed
    // on the mark held it forever.
    it.each([
      'prevented',
      'warning_closed',
    ])('a chargeback that ends %s, which leaves its mark, no longer holds it: the next sweep refunds it', async (end) => {
      const { service, stripe } = fresh();
      const { pi, asksFor } = await owedBlocked(service, stripe);
      const disputeId = await openChargeback(service, pi);
      vi.mocked(stripe.refunds.create).mockRejectedValue(refusal());
      await sweep(service);
      expect(asksFor()).toHaveLength(1);

      await recordChargeback(service, pi, disputeId, end);
      expect((await rowOf(pi)).disputedAt).not.toBeNull();
      vi.mocked(stripe.refunds.create).mockResolvedValue({
        id: `re_${end}_${uid()}`,
      } as never);
      await sweep(service);

      const asks = asksFor();
      expect(asks).toHaveLength(2);
      expect(asks[1]?.[1]).toEqual({ idempotencyKey: `${key}${pi}_1500` });
      expect((await rowOf(pi)).status).toBe('refunded');
    });

    it('a chargeback LOST in full leaves nothing owed: the row is refunded, the sweep never asks Stripe for it, and nobody is alerted', async () => {
      const { service, stripe } = fresh();
      const { item, customerId, pi, asksFor } = await owedBlocked(
        service,
        stripe
      );
      const disputeId = await openChargeback(service, pi);
      await recordChargeback(service, pi, disputeId, 'lost');
      const errors = errorsOf(service);

      await service.processLostDispute(pi, 1500, disputeId);

      expect(await rowOf(pi)).toMatchObject({
        status: 'refunded',
        refundAmountCents: 1500,
      });
      await sweep(service);
      expect(asksFor()).toHaveLength(1);
      expect(errors.mock.calls.map(([message]) => message)).not.toContain(
        SHORT_ALERT
      );
      expect(
        shortReported(errors).map((entry) => entry.stripePaymentIntentId)
      ).not.toContain(pi);
      // A duplicate's buyer keeps the item through their first purchase.
      expect(await grantsOf(customerId, item.id)).toEqual(
        kind === 'duplicate'
          ? { entitlements: 1, access: 1 }
          : { entitlements: 0, access: 0 }
      );
    });

    it('a chargeback LOST for less than the payment alerts support for the rest, by amount, and refunds nothing (owner D59)', async () => {
      const { service, stripe } = fresh();
      const { pi, asksFor } = await owedBlocked(service, stripe);
      const disputeId = await openChargeback(service, pi);
      await recordChargeback(service, pi, disputeId, 'lost', {
        amountCents: 500,
      });
      const errors = errorsOf(service);

      await service.processLostDispute(pi, 500, disputeId);

      const row = await rowOf(pi);
      expect(row).toMatchObject({ status: 'refunded', refundAmountCents: 500 });
      expect(errors).toHaveBeenCalledWith(SHORT_ALERT, {
        errorId: expect.any(String),
        purchaseId: row.id,
        stripePaymentIntentId: pi,
        stripeDisputeId: disputeId,
        kind,
        owedCents: 1000,
        currency: 'gbp',
      });
      // A redelivery of the loss applies nothing again, and alerts nothing.
      errors.mockClear();
      await service.processLostDispute(pi, 500, disputeId);
      expect(errors.mock.calls.map(([message]) => message)).not.toContain(
        SHORT_ALERT
      );
      await sweep(service);
      expect(asksFor()).toHaveLength(1);
    });

    // Review r3 (LOW): the alert at the loss is logged once, so the debt is
    // read again from the stored rows every run until it is paid.
    it('the hourly sweep reports a short loss every run, from the stored rows, until a refund makes the buyer whole', async () => {
      const { service, stripe } = fresh();
      const { pi } = await owedBlocked(service, stripe);
      const disputeId = await openChargeback(service, pi);
      await recordChargeback(service, pi, disputeId, 'lost', {
        amountCents: 500,
      });
      await service.processLostDispute(pi, 500, disputeId);
      const errors = errorsOf(service);

      await sweep(service);
      await sweep(service);

      const entry = {
        purchaseId: (await rowOf(pi)).id,
        stripePaymentIntentId: pi,
        stripeDisputeId: disputeId,
        kind,
        owedCents: 1000,
        currency: 'gbp',
      };
      const mine = shortReported(errors).filter(
        (reported) => reported.stripePaymentIntentId === pi
      );
      expect(mine).toEqual([entry, entry]);
      const reports = errors.mock.calls.filter(
        ([message]) => message === SHORT_REPORT
      );
      expect(reports).toHaveLength(2);
      expect(reports[0]?.[1]).toMatchObject({
        errorId: expect.any(String),
        total: expect.any(Number),
      });

      // Support refunds the rest by hand: once it stands, nothing is owed.
      await recordPartRefund(service, pi, 1000);
      errors.mockClear();
      await sweep(service);
      expect(
        shortReported(errors).map((reported) => reported.stripePaymentIntentId)
      ).not.toContain(pi);
      expect(await rowOf(pi)).toMatchObject({ status: 'refunded' });
    });

    // Review r4 (D60): oldest first under a limit, rows support could never
    // clear hid every NEW short loss. Newest dispute first now, and the line
    // says how many there are in all, so a tail past the limit shows.
    it('the report lists the newest short loss first, up to the limit, with how many there are in all', async () => {
      const { service, stripe } = fresh();
      const shortLoss = async (openedAt: Date) => {
        const { pi } = await owedBlocked(service, stripe);
        const disputeId = await openChargeback(service, pi, openedAt);
        await recordChargeback(service, pi, disputeId, 'lost', {
          openedAt,
          amountCents: 500,
        });
        await service.processLostDispute(pi, 500, disputeId);
        return pi;
      };
      const older = await shortLoss(new Date(Date.now() - 10 * 86_400_000));
      // Ahead of any other file's loss in the shared database.
      const newer = await shortLoss(new Date(Date.now() + 60_000));
      const all = await findShortLosses(db, {
        stage: 'short',
        includeMarked: false,
        limit: 100_000,
      });
      expect(all.rows.map((row) => row.stripePaymentIntentId)).toEqual(
        expect.arrayContaining([older, newer])
      );
      vi.mocked(stripe.refunds.create).mockRejectedValue(refusal());
      const errors = errorsOf(service);

      await service.settleOwedDuplicates({ olderThanMs: 0, limit: 1 });

      const reports = errors.mock.calls.filter(
        ([message]) => message === SHORT_REPORT
      );
      expect(reports).toHaveLength(1);
      const report = reports[0]?.[1] as {
        total: number;
        owed: Array<{ stripePaymentIntentId: string }>;
      };
      expect(report.owed.map((entry) => entry.stripePaymentIntentId)).toEqual([
        newer,
      ]);
      // The total is every short loss, not the page of one: at least this
      // file's two. It is `findShortLosses`' own count, so it is not compared
      // with `all.total`: the database is shared, and another file's loss
      // recorded or marked between that read and the sweep moves it.
      expect(report.total).toBeGreaterThanOrEqual(2);
    });

    // Review r4 (nit): with no dispute row the loss knew no charge, so an
    // unlinked refund on it was left out of what the buyer has back. The
    // webhook passes the loss's own charge.
    it('a loss with no dispute row counts an unlinked refund on its own charge', async () => {
      const { service, stripe } = fresh();
      const chargeId = `ch_norow_${kind}_${uid()}`;
      const { pi } = await owedBlocked(service, stripe, {
        stripeChargeId: chargeId,
      });
      // Recorded before the purchase existed (Codex-aa08z): no purchase_id.
      const unlinked = `re_unlinked_${uid()}`;
      await db.insert(refunds).values({
        stripeRefundId: unlinked,
        stripeChargeId: chargeId,
        purchaseId: null,
        amountCents: 300,
        currency: 'gbp',
        status: 'succeeded',
        stripeCreatedAt: new Date(),
      });
      const disputeId = `dp_norow_${kind}_${uid()}`;
      const errors = errorsOf(service);
      try {
        await service.processLostDispute(pi, 1000, disputeId, { chargeId });

        const row = await rowOf(pi);
        expect(row).toMatchObject({
          status: 'refunded',
          refundAmountCents: 1300,
        });
        expect(errors).toHaveBeenCalledWith(
          SHORT_ALERT,
          expect.objectContaining({
            stripeDisputeId: disputeId,
            owedCents: 200,
          })
        );
      } finally {
        await db.delete(refunds).where(eq(refunds.stripeRefundId, unlinked));
      }
    });

    // Owed again needs support's first mark (owner D63): with none, the late
    // win refunds the charge through Stripe, so neither line names it.
    it('a short loss that is then won late, never marked, is not reported on either line', async () => {
      const { service, stripe } = fresh();
      const { pi } = await owedBlocked(service, stripe);
      const disputeId = await openChargeback(service, pi);
      await recordChargeback(service, pi, disputeId, 'lost', {
        amountCents: 500,
      });
      await service.processLostDispute(pi, 500, disputeId);
      await recordChargeback(service, pi, disputeId, 'won');
      expect((await disputeOf(disputeId)).status).toBe('won');
      const errors = errorsOf(service);

      await sweep(service);

      for (const line of [SHORT_REPORT, OWED_AGAIN_REPORT]) {
        expect(
          shortReported(errors, line).map(
            (reported) => reported.stripePaymentIntentId
          )
        ).not.toContain(pi);
      }
    });

    // Review r3 (CRITICAL by corroboration): a pending blocked row records no
    // part refund of its own, so the loss counts the refunds standing on the
    // charge, never the row's refund_amount_cents.
    it('a part refund, then a chargeback lost for the rest: the buyer is whole, refunded at what they paid, and nobody is alerted', async () => {
      const { service, stripe } = fresh();
      const { pi } = await owedBlocked(service, stripe);
      await recordPartRefund(service, pi, 500);
      expect(await rowOf(pi)).toMatchObject({
        status: 'pending',
        refundAmountCents: null,
      });
      const disputeId = await openChargeback(service, pi);
      await recordChargeback(service, pi, disputeId, 'lost', {
        amountCents: 1000,
      });
      const errors = errorsOf(service);

      await service.processLostDispute(pi, 1000, disputeId);
      await sweep(service);

      expect(await rowOf(pi)).toMatchObject({
        status: 'refunded',
        refundAmountCents: 1500,
      });
      expect(errors.mock.calls.map(([message]) => message)).not.toContain(
        SHORT_ALERT
      );
      expect(
        shortReported(errors).map((reported) => reported.stripePaymentIntentId)
      ).not.toContain(pi);
    });

    it('a part refund, then a chargeback lost for less than the rest: the alert and the report name what is still owed', async () => {
      const { service, stripe } = fresh();
      const { pi } = await owedBlocked(service, stripe);
      await recordPartRefund(service, pi, 300);
      const disputeId = await openChargeback(service, pi);
      await recordChargeback(service, pi, disputeId, 'lost', {
        amountCents: 1000,
      });
      const errors = errorsOf(service);

      await service.processLostDispute(pi, 1000, disputeId);
      await sweep(service);

      const row = await rowOf(pi);
      expect(row).toMatchObject({
        status: 'refunded',
        refundAmountCents: 1300,
      });
      expect(errors).toHaveBeenCalledWith(SHORT_ALERT, {
        errorId: expect.any(String),
        purchaseId: row.id,
        stripePaymentIntentId: pi,
        stripeDisputeId: disputeId,
        kind,
        owedCents: 200,
        currency: 'gbp',
      });
      expect(
        shortReported(errors).filter(
          (reported) => reported.stripePaymentIntentId === pi
        )
      ).toEqual([expect.objectContaining({ owedCents: 200 })]);
    });

    // Owner D66, review r6/r7: what a blocked payment is owed counts its
    // refunds by ONE rule (`countedRefundOf`): on its CHARGE, standing or
    // failed and settled refunded elsewhere. A blocked payment writes no
    // payout slices, so a read through them (`refundsOfPurchase`) would drop
    // a refund recorded without its purchase; a failed refund support settled
    // refunded elsewhere is money the buyer has back; and a refund on another
    // charge is not this charge's, whatever purchase it names (review r7: no
    // writer makes one, so the rule never needs the purchase's rows). £15.00
    // paid, £3.00 refunded, £10.00 lost: £2.00 owed; £5.00 when the £3.00
    // failed and is not settled, or is another charge's.
    it.each([
      {
        refund: 'recorded without its purchase (before it existed)',
        owedCents: 200,
      },
      { refund: 'failed, and settled refunded elsewhere', owedCents: 200 },
      { refund: 'failed, and not settled', owedCents: 500 },
      {
        refund: 'of ANOTHER charge, under the same purchase',
        owedCents: 500,
      },
    ])('a £3.00 refund on the charge $refund, then a chargeback lost for £10.00: $owedCents pence still owed', async ({
      refund,
      owedCents,
    }) => {
      const { service, stripe } = fresh();
      const disputeId = `dp_counted_${kind}_${uid()}`;
      const chargeId = `ch_${disputeId}`;
      const { pi } = await owedBlocked(service, stripe, {
        stripeChargeId: chargeId,
      });
      const purchase = await rowOf(pi);
      expect(await slicesOf(purchase.id)).toHaveLength(0);
      const stripeRefundId = `re_counted_${uid()}`;
      const unlinked = refund.startsWith('recorded');
      const otherCharge = refund.includes('ANOTHER charge');
      const standing = unlinked || otherCharge;
      if (unlinked) unlinkedRefundIds.push(stripeRefundId);
      await service.recordRefund({
        stripeRefundId,
        stripeChargeId: otherCharge ? `ch_other_${uid()}` : chargeId,
        paymentIntentId: unlinked ? null : pi,
        amountCents: 300,
        currency: 'gbp',
        status: standing ? 'succeeded' : 'failed',
        reason: null,
        failureReason: standing ? null : 'expired_or_canceled_card',
        stripeCreatedAt: new Date(),
      });
      if (refund.includes('settled refunded elsewhere')) {
        await db
          .update(refunds)
          .set({ resolution: 'refunded_elsewhere', resolvedAt: new Date() })
          .where(eq(refunds.stripeRefundId, stripeRefundId));
      }
      expect(
        takeFirst(
          await db
            .select({ purchaseId: refunds.purchaseId })
            .from(refunds)
            .where(eq(refunds.stripeRefundId, stripeRefundId))
        ).purchaseId
      ).toBe(unlinked ? null : purchase.id);
      await recordChargeback(service, pi, disputeId, 'needs_response');
      await service.processDispute(pi, { stripeDisputeId: disputeId });
      await recordChargeback(service, pi, disputeId, 'lost', {
        amountCents: 1000,
      });

      await service.processLostDispute(pi, 1000, disputeId);

      const {
        rows: [owed],
      } = await findShortLosses(db, {
        chargeId,
        stage: 'short',
        includeMarked: false,
        limit: 1,
      });
      expect(owed).toMatchObject({ stripeDisputeId: disputeId, owedCents });
    });

    // Review r3 (nit): a report runs after the refunds and can't stop them.
    it('a failed report never stops the refunds: both run after them, and each logs its own error', async () => {
      const { service, stripe } = fresh();
      const { pi, asksFor } = await owedBlocked(service, stripe);
      vi.mocked(stripe.refunds.create).mockResolvedValue({
        id: `re_after_${uid()}`,
      } as never);
      // A sweep whose database fails both reports' queries, known by their
      // columns (only they read `openedAt` and `owedCents`); every other
      // statement runs.
      const failingDb = new Proxy(db, {
        get(target, property) {
          if (property === 'select') {
            return (fields?: Record<string, unknown>) => {
              if (fields && ('openedAt' in fields || 'owedCents' in fields)) {
                throw new Error('the check failed');
              }
              return target.select(fields as never);
            };
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const sweeping = new PurchaseService(
        { db: failingDb, environment: 'test', ...createTestMoneyDeps() },
        stripe
      );
      const errors = errorsOf(sweeping);

      await sweep(sweeping);

      expect(asksFor()).toHaveLength(2);
      expect((await rowOf(pi)).status).toBe('refunded');
      // Both backstops failed, each naming its check (review r8).
      expect(
        errors.mock.calls.filter(
          ([message]) =>
            message ===
            "Could not check for chargebacks held past 120 days; the sweep's refunds are not affected"
        )
      ).toEqual(
        ['blocked_refunds_held', 'failed_refunds_waiting'].map((check) => [
          expect.any(String),
          {
            errorId: expect.any(String),
            link: 'purchase',
            check,
            error: 'the check failed',
          },
        ])
      );
      // One per stage, each naming its own: one failed stage never hides
      // the other.
      expect(
        errors.mock.calls.filter(
          ([message]) =>
            message ===
            "Could not check for blocked payments a lost chargeback left short; the sweep's refunds are not affected"
        )
      ).toEqual([
        [
          expect.any(String),
          {
            errorId: expect.any(String),
            stage: 'short',
            error: 'the check failed',
          },
        ],
        [
          expect.any(String),
          {
            errorId: expect.any(String),
            stage: 'owed_again',
            error: 'the check failed',
          },
        ],
      ]);
    });

    // Review r3 (nit): `recordDispute` links a purchase only if it finds one.
    it('a chargeback recorded before its purchase existed is linked as the purchase lands, and holds its refund', async () => {
      const { service, stripe } = fresh();
      const disputeId = `dp_early_${kind}_${uid()}`;
      const { pi, asksFor } = await owedBlocked(service, stripe, {
        stripeChargeId: `ch_${disputeId}`,
        beforePurchase: async (early) => {
          await recordChargeback(service, early, disputeId, 'needs_response');
          expect((await disputeOf(disputeId)).purchaseId).toBeNull();
        },
      });

      expect((await disputeOf(disputeId)).purchaseId).toBe(
        (await rowOf(pi)).id
      );
      vi.mocked(stripe.refunds.create).mockRejectedValue(refusal());
      await sweep(service);
      expect(asksFor()).toHaveLength(1);
      expect((await rowOf(pi)).status).toBe('pending');
    });

    it('one recorded before a purchase that landed without its charge is linked when the dispute is next recorded', async () => {
      const { service, stripe } = fresh();
      const disputeId = `dp_early_nocharge_${kind}_${uid()}`;
      const { pi, asksFor } = await owedBlocked(service, stripe, {
        landsUnnamed: true,
        beforePurchase: (early) =>
          recordChargeback(service, early, disputeId, 'needs_response'),
      });
      expect((await disputeOf(disputeId)).purchaseId).toBeNull();

      await recordChargeback(service, pi, disputeId, 'under_review');

      expect(await disputeOf(disputeId)).toMatchObject({
        purchaseId: (await rowOf(pi)).id,
        status: 'under_review',
      });
      vi.mocked(stripe.refunds.create).mockRejectedValue(refusal());
      await sweep(service);
      expect(asksFor()).toHaveLength(1);
    });

    it('a chargeback still open past 120 days is alerted at error with its ids, and the row is still left to it; a younger one is not alerted', async () => {
      const { service, stripe } = fresh();
      const old = await owedBlocked(service, stripe);
      const oldDispute = await openChargeback(
        service,
        old.pi,
        new Date(Date.now() - 121 * 24 * 60 * 60 * 1000)
      );
      const young = await owedBlocked(service, stripe);
      const youngDispute = await openChargeback(
        service,
        young.pi,
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      );
      vi.mocked(stripe.refunds.create).mockRejectedValue(refusal());
      const errors = errorsOf(service);

      const swept = await sweep(service);

      const heldLines = errors.mock.calls.filter(
        ([message]) => message === HELD_ALERT
      );
      expect(heldLines).toHaveLength(1);
      const held = (
        heldLines[0]?.[1] as {
          held: Array<{ id: string; stripeDisputeId: string }>;
        }
      ).held;
      expect(held).toContainEqual(
        expect.objectContaining({
          id: (await rowOf(old.pi)).id,
          stripeDisputeId: oldDispute,
        })
      );
      expect(held.map((h) => h.stripeDisputeId)).not.toContain(youngDispute);
      // Still held while it reads open: support checks the dispute first.
      expect(old.asksFor()).toHaveLength(1);
      expect(swept.stillOwed.map((o) => o.stripePaymentIntentId)).not.toContain(
        old.pi
      );
      expect((await rowOf(old.pi)).status).toBe('pending');
    });

    // Review r7 (silent 3): a failed refund waiting for its open chargeback
    // (owner D67) waits for ever if the close is never recorded. The queue
    // shows when the chargeback opened; past the same backstop, the sweep
    // alerts with the ids (backend only: no new queue copy).
    it('a failed refund waiting on a chargeback opened past the backstop is alerted with its ids; a young one, or one settled, is not', async () => {
      const { service, stripe } = fresh();
      const WAITING_ALERT =
        'Failed refunds of blocked payments still waiting for a chargeback after 120 days: check the dispute in Stripe; each stays waiting in Failed refunds until its close is recorded';
      const DAY = 24 * 60 * 60 * 1000;
      /** Refunded, then its refund failed while a chargeback opened `daysAgo`. */
      async function waiting(daysAgo: number, { settled = false } = {}) {
        const blocked = await owedBlocked(service, stripe);
        vi.mocked(stripe.refunds.create).mockResolvedValueOnce({
          id: `re_made_${uid()}`,
        } as never);
        await sweep(service);
        expect((await rowOf(blocked.pi)).status).toBe('refunded');
        const stripeRefundId = `re_waiting_${uid()}`;
        await service.recordRefund({
          stripeRefundId,
          stripeChargeId: blocked.chargeId,
          paymentIntentId: blocked.pi,
          amountCents: 1500,
          currency: 'gbp',
          status: 'failed',
          reason: null,
          failureReason: 'charge_for_pending_refund_disputed',
          stripeCreatedAt: new Date(),
        });
        if (settled) {
          await db
            .update(refunds)
            .set({ resolution: 'refunded_elsewhere', resolvedAt: new Date() })
            .where(eq(refunds.stripeRefundId, stripeRefundId));
        }
        const disputeId = await openChargeback(
          service,
          blocked.pi,
          new Date(Date.now() - daysAgo * DAY)
        );
        return { purchaseId: (await rowOf(blocked.pi)).id, disputeId };
      }
      const old = await waiting(121);
      const young = await waiting(30);
      const settled = await waiting(121, { settled: true });
      vi.mocked(stripe.refunds.create).mockRejectedValue(refusal());
      const errors = errorsOf(service);

      await sweep(service);

      const lines = errors.mock.calls.filter(
        ([message]) => message === WAITING_ALERT
      );
      expect(lines).toHaveLength(1);
      const { link, held } = lines[0]?.[1] as {
        link: string;
        held: Array<{ id: string; stripeDisputeId: string; openedAt: string }>;
      };
      expect(link).toBe('purchase');
      expect(held).toContainEqual({
        id: old.purchaseId,
        stripeDisputeId: old.disputeId,
        openedAt: expect.any(String),
      });
      const named = held.map((row) => row.stripeDisputeId);
      expect(named).not.toContain(young.disputeId);
      expect(named).not.toContain(settled.disputeId);
      // Refunded, so never the owed rows' line.
      const heldOwed = errors.mock.calls
        .filter(([message]) => message === HELD_ALERT)
        .flatMap(
          ([, meta]) =>
            (meta as { held: Array<{ stripeDisputeId: string }> }).held
        )
        .map((row) => row.stripeDisputeId);
      expect(heldOwed).not.toContain(old.disputeId);
    });
  });

  describe('a refund Stripe refuses', () => {
    // The blocked row committed, so the completion did not fail: only the
    // refusal is logged, never "Failed to complete purchase" beside it. The
    // error the caller gets is unchanged, retryable, so Stripe redelivers.
    it('logs the refusal alone, and rejects with a retryable refusal', async () => {
      const { service, stripe } = fresh();
      vi.mocked(stripe.refunds.create).mockRejectedValueOnce(refusal());
      const alerts = alertsOf(service);
      const item = await insertContent({ deletedAt: new Date() });
      const customerId = await buyer();
      const pi = `pi_refused_log_${uid()}`;

      const failure = await complete(service, pi, customerId, item.id).catch(
        (error: unknown) => error
      );

      expect(failure).toBeInstanceOf(ServiceUnavailableError);
      expect(failure).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      expect(alerts()).toEqual([
        'Payment for an unavailable item could not be refunded',
      ]);
      expect(await rowOf(pi)).toMatchObject({
        status: 'pending',
        refundReason: 'item_unavailable',
      });
    });

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
      // Support is told which kind it is: this buyer has nothing.
      expect(
        refused.stillOwed.find((o) => o.stripePaymentIntentId === pi)?.blocked
      ).toBe('unavailable');
      expect((await rowOf(pi)).status).toBe('pending');

      // Stripe accepts: refunded, and no longer owed. Real Stripe keeps the
      // FIRST response under a key for about 24 hours, the refusal included,
      // so a retry under this same key reaches Stripe afresh only once that
      // has expired: in production this step is the first sweep a day later,
      // not the next hour's. The mock stands for that later sweep.
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
      expect(new Set(keys)).toEqual(new Set([`refund_unavailable_${pi}_1500`]));
    });

    // The refund email of a partial refund of a blocked sale says "the rest
    // will follow" (payment-webhook.ts `purchaseAccessNote`). It does: the
    // partial refund leaves the row pending, and the sweep refunds what is
    // left: it syncs the charge's refunds, so the part counts, and asks for
    // the rest under a key naming it (owner D73).
    it('a PARTIAL refund made elsewhere while it is owed leaves it owed: the hourly sweep refunds the rest', async () => {
      const { service, stripe } = fresh();
      vi.mocked(stripe.refunds.create).mockRejectedValueOnce(refusal());
      const item = await insertContent({ deletedAt: new Date() });
      const customerId = await buyer();
      const pi = `pi_part_owed_${uid()}`;
      // The payment's one charge, which its refund names too (review r7).
      const charge = { id: `ch_part_owed_${uid()}`, amountCents: 1500 };
      await expect(
        complete(service, pi, customerId, item.id, charge.id)
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

      // Support refunds £5.00 of £15.00 in the Stripe Dashboard.
      const partId = `re_part_${uid()}`;
      const part = await service.processRefund(pi, {
        charge,
        refundAmountCents: 500,
        stripeRefundId: partId,
        refundReason: 'requested_by_customer',
      });
      // What the sweep's sync reads: the PaymentIntent's charge, and its
      // refunds as Stripe lists them.
      chargesItsRefund(stripe, pi, charge.id, partId, 500);

      expect(part).toMatchObject({ itemUnavailable: true, accessEnded: false });
      expect(await rowOf(pi)).toMatchObject({
        status: 'pending',
        refundReason: 'item_unavailable',
      });

      vi.mocked(stripe.refunds.create).mockResolvedValue({
        id: `re_rest_${uid()}`,
      } as never);
      const swept = await service.settleOwedDuplicates({
        olderThanMs: 0,
        limit: 1000,
      });

      expect(swept.stillOwed.map((o) => o.stripePaymentIntentId)).not.toContain(
        pi
      );
      const asks = vi
        .mocked(stripe.refunds.create)
        .mock.calls.map((_, index) => refundCall(stripe, index))
        .filter(([params]) => params?.payment_intent === pi);
      // The refusal, then the sweep's: the £10.00 left once the part
      // counts, never the £15.00 again.
      expect(asks).toHaveLength(2);
      expect(asks[1]?.[0]).toMatchObject({ amount: 1000 });
      expect(asks[1]?.[1]).toEqual({
        idempotencyKey: `refund_unavailable_${pi}_1000`,
      });
      expect(await rowOf(pi)).toMatchObject({
        status: 'refunded',
        refundReason: 'item_unavailable',
      });
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });
    });

    // The refund email's words come from these (review r2 LOW), so they are
    // read from the refunds standing now, which the caller passes in.
    it('says, from the standing total, whether the charge is refunded in full and whether the rest is still owed', async () => {
      const { service, stripe } = fresh();
      vi.mocked(stripe.refunds.create).mockRejectedValueOnce(refusal());
      const item = await insertContent({ deletedAt: new Date() });
      const customerId = await buyer();
      const pi = `pi_words_${uid()}`;
      await expect(
        complete(service, pi, customerId, item.id)
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      const charge = { id: `ch_words_${uid()}`, amountCents: 1500 };

      // Part of it, while the row is pending: the rest is owed, and comes.
      expect(
        await service.processRefund(pi, { charge, refundAmountCents: 500 })
      ).toMatchObject({
        itemUnavailable: true,
        refundedInFull: false,
        restOwed: true,
      });
      expect((await rowOf(pi)).status).toBe('pending');

      // The rest lands: in full, nothing owed.
      expect(
        await service.processRefund(pi, { charge, refundAmountCents: 1500 })
      ).toMatchObject({ refundedInFull: true, restOwed: false });
      expect((await rowOf(pi)).status).toBe('refunded');

      // Less stands after that (a refund failed): refunded, so nothing is
      // promised, and not in full.
      expect(
        await service.processRefund(pi, { charge, refundAmountCents: 500 })
      ).toMatchObject({ refundedInFull: false, restOwed: false });
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
      const chargeId = `ch_heal_part_${uid()}`;
      sessionFor(stripe, customerId, item.id);

      await service.processRefund(pi, {
        charge: { id: chargeId, amountCents: 1500 },
        refundAmountCents: 500,
      });
      chargesItsRefund(stripe, pi, chargeId, `re_heal_part_${uid()}`, 500);

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
      // The rest: its sync counted the £5.00 part refund (owner D73).
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(refundCall(stripe, 0)[0]).toMatchObject({ amount: 1000 });
      expect(refundCall(stripe, 0)[1]).toEqual({
        idempotencyKey: `refund_unavailable_${pi}_1000`,
      });
      expect(await grantsOf(customerId, item.id)).toEqual({
        entitlements: 0,
        access: 0,
      });
    });

    // Review r3 (nit): as completion links them.
    it('a chargeback recorded before the rebuild is linked to the rebuilt row', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent({ isTeamOnly: true });
      const customerId = await buyer();
      const pi = `pi_heal_dispute_${uid()}`;
      const chargeId = `ch_heal_dispute_${uid()}`;
      const disputeId = `dp_heal_${uid()}`;
      await service.recordDispute({
        stripeDisputeId: disputeId,
        stripeChargeId: chargeId,
        paymentIntentId: pi,
        amountCents: 1500,
        currency: 'gbp',
        status: 'needs_response',
        reason: 'fraudulent',
        stripeCreatedAt: new Date(),
      });
      sessionFor(stripe, customerId, item.id);

      await service.processRefund(pi, {
        charge: { id: chargeId, amountCents: 1500 },
        refundAmountCents: 500,
      });

      const row = await rowOf(pi);
      expect(row.status).toBe('pending');
      const [dispute] = await db
        .select({ purchaseId: disputes.purchaseId })
        .from(disputes)
        .where(eq(disputes.stripeDisputeId, disputeId));
      expect(dispute?.purchaseId).toBe(row.id);
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

  // A course is blocked when its dashboard would refuse its buyer
  // (`courseRefusesBuyers`, the rule `loadCourseSummaryById` holds in SQL):
  // its organisation deleted, or never released. Archived or off sale, its
  // buyers keep it (Codex-yo4px), so that completes.
  describe('a course', () => {
    /** A course of `orgId`'s at £49.99, released unless `values` say not. */
    async function insertCourse(
      orgId: string,
      values: Partial<typeof courses.$inferInsert> = {}
    ) {
      return takeFirst(
        await db
          .insert(courses)
          .values({
            organizationId: orgId,
            creatorId,
            slug: createUniqueSlug('z1t3c-course'),
            title: `Course ${uid()}`,
            status: 'published',
            publishedAt: new Date('2026-01-01T00:00:00Z'),
            priceCents: 4999,
            ...values,
          })
          .returning()
      );
    }

    function completeCourse(
      service: PurchaseService,
      pi: string,
      customerId: string,
      courseId: string,
      stripeChargeId?: string
    ) {
      return service.completeCoursePurchase(pi, {
        customerId,
        courseId,
        amountPaidCents: 4999,
        currency: 'gbp',
        stripeChargeId,
      });
    }

    /** What the buyer holds for the course: live grants and enrolments. */
    async function courseGrantsOf(customerId: string, courseId: string) {
      const [live, enrolled] = await Promise.all([
        db
          .select({ id: entitlements.id })
          .from(entitlements)
          .where(
            and(
              eq(entitlements.userId, customerId),
              eq(entitlements.courseId, courseId),
              isNull(entitlements.revokedAt)
            )
          ),
        db
          .select({ id: courseEnrollments.id })
          .from(courseEnrollments)
          .where(
            and(
              eq(courseEnrollments.userId, customerId),
              eq(courseEnrollments.courseId, courseId)
            )
          ),
      ]);
      return { entitlements: live.length, enrolments: enrolled.length };
    }

    it('taken off sale while Checkout is open: still completes, granting the course', async () => {
      const { service, stripe } = fresh();
      const course = await insertCourse(organizationId, {
        status: 'archived',
        offSaleAt: new Date(),
      });
      const customerId = await buyer();

      const result = await completeCourse(
        service,
        `pi_course_${uid()}`,
        customerId,
        course.id
      );

      expect(result).toMatchObject({ status: 'completed', refundReason: null });
      expect(stripe.refunds.create).not.toHaveBeenCalled();
      expect((await courseGrantsOf(customerId, course.id)).entitlements).toBe(
        1
      );
    });

    it('its organisation deleted before the payment lands: a blocked sale, no entitlement, no slices, refunded once in full under its own key', async () => {
      const { service, stripe } = fresh();
      const orgId = await ownOrg();
      const course = await insertCourse(orgId);
      await deleteOrg(db, orgId);
      const customerId = await buyer();
      const pi = `pi_course_org_gone_${uid()}`;

      const result = await completeCourse(
        service,
        pi,
        customerId,
        course.id,
        `ch_course_org_gone_${uid()}`
      );

      expect(result).toMatchObject({
        status: 'refunded',
        refundReason: 'item_unavailable',
        duplicateOfPurchaseId: null,
        refundAmountCents: 4999,
      });
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      const [params, options] = refundCall(stripe, 0);
      expect(params).toMatchObject({ payment_intent: pi });
      expect(params).not.toHaveProperty('reason');
      expect(options).toEqual({
        idempotencyKey: `refund_unavailable_${pi}_4999`,
      });
      expect(await slicesOf(result.id)).toHaveLength(0);
      expect(await courseGrantsOf(customerId, course.id)).toEqual({
        entitlements: 0,
        enrolments: 0,
      });
    });

    it('a refused refund logs the refusal alone, never "Failed to complete course purchase", and rejects retryably', async () => {
      const { service, stripe } = fresh();
      vi.mocked(stripe.refunds.create).mockRejectedValueOnce(refusal());
      const alerts = alertsOf(service);
      const orgId = await ownOrg();
      const course = await insertCourse(orgId);
      await deleteOrg(db, orgId);
      const customerId = await buyer();
      const pi = `pi_course_refused_log_${uid()}`;

      const failure = await completeCourse(
        service,
        pi,
        customerId,
        course.id
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ServiceUnavailableError);
      expect(failure).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      expect(alerts()).toEqual([
        'Payment for an unavailable item could not be refunded',
      ]);
      expect(await courseGrantsOf(customerId, course.id)).toEqual({
        entitlements: 0,
        enrolments: 0,
      });
    });

    it('never released (a legacy course back in draft with no published_at): blocked and refunded the same way', async () => {
      const { service, stripe } = fresh();
      const course = await insertCourse(organizationId, {
        status: 'draft',
        publishedAt: null,
      });
      const customerId = await buyer();
      const pi = `pi_course_draft_${uid()}`;

      const result = await completeCourse(service, pi, customerId, course.id);

      expect(result).toMatchObject({
        status: 'refunded',
        refundReason: 'item_unavailable',
      });
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(await courseGrantsOf(customerId, course.id)).toEqual({
        entitlements: 0,
        enrolments: 0,
      });
    });

    it('charge.refunded before the checkout lands (the self-heal): rebuilt as a refunded blocked sale, granting nothing; the checkout then asks Stripe nothing', async () => {
      const { service, stripe } = fresh();
      const orgId = await ownOrg();
      const course = await insertCourse(orgId);
      await deleteOrg(db, orgId);
      const customerId = await buyer();
      const pi = `pi_course_heal_${uid()}`;
      stripe.checkout.sessions.list = vi.fn().mockResolvedValue({
        data: [
          {
            id: `cs_course_heal_${uid()}`,
            amount_total: 4999,
            currency: 'gbp',
            created: Math.floor(Date.now() / 1000),
            metadata: { kind: 'course', customerId, courseId: course.id },
          },
        ],
      }) as never;

      const refunded = await service.processRefund(pi, {
        charge: { id: `ch_course_heal_${uid()}`, amountCents: 4999 },
        refundAmountCents: 4999,
        refundReason: 'requested_by_customer',
      });

      expect(refunded).toMatchObject({
        itemUnavailable: true,
        duplicatePayment: false,
      });
      expect(await rowOf(pi)).toMatchObject({
        courseId: course.id,
        status: 'refunded',
        refundReason: 'item_unavailable',
      });
      expect(await courseGrantsOf(customerId, course.id)).toEqual({
        entitlements: 0,
        enrolments: 0,
      });

      // The checkout webhook lands after: the row stands, nothing more.
      const landed = await completeCourse(service, pi, customerId, course.id);
      expect(landed.status).toBe('refunded');
      expect(stripe.refunds.create).not.toHaveBeenCalled();
      expect(await courseGrantsOf(customerId, course.id)).toEqual({
        entitlements: 0,
        enrolments: 0,
      });
    });

    it('an organisation delete in flight: the completion waits on the organisation’s row lock, then reads the delete and blocks the sale', async () => {
      const { stripe } = fresh();
      const orgId = await ownOrg();
      const course = await insertCourse(orgId);
      const customerId = await buyer();
      const pi = `pi_course_race_${uid()}`;
      const conn = await ownConnection();
      let work = track(Promise.resolve());
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '10s'`);
          // As `OrganizationService.delete` writes it: the organisation row
          // alone, held FOR NO KEY UPDATE until it commits. Its courses stay.
          await deleteOrg(tx, orgId);
          const holder = await backendPid(tx);
          work = track(
            completeCourse(
              new PurchaseService(
                { db: conn.db, environment: 'test', ...createTestMoneyDeps() },
                stripe
              ),
              pi,
              customerId,
              course.id,
              `ch_course_race_${uid()}`
            )
          );
          // Proof of the wait: blocked by this transaction, on
          // `organizations`, the course row's own lock already held.
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
      expect(await courseGrantsOf(customerId, course.id)).toEqual({
        entitlements: 0,
        enrolments: 0,
      });
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
