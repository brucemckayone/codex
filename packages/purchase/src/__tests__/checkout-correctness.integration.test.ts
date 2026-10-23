/**
 * Checkout correctness (Codex-2hxff.14). Owner decisions 2026-10-21/22:
 *
 * - **Only what a purchase opens is sold.** Course-only, team-only,
 *   followers-only and not-purchasable content is refused at checkout.
 * - **Block, then refund.** A second checkout for an item reuses the buyer's
 *   open session (one Stripe page, so one payment). A second payment that
 *   lands anyway is recorded refunded, grants and pays nothing, and is
 *   refunded in full; the buyer keeps the item through the first purchase.
 * - **30 minutes.** A session expires 30 minutes after it is made (sent as
 *   31 to clear Stripe's floor).
 *
 * Stripe is the shared mock; one test teaches it Stripe's idempotency so two
 * concurrent callers on one reservation get one session, as they would live.
 */

import { CHECKOUT_SESSION_STATUS } from '@codex/constants';
import * as schema from '@codex/database/schema';
import { ServiceUnavailableError } from '@codex/service-errors';
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
import { and, eq, isNull } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ContentNotPurchasableError,
  CourseAlreadyOwnedError,
  PaymentProcessingError,
} from '../errors';
import { PurchaseService } from '../services/purchase-service';

const URLS = {
  successUrl: 'http://localhost:3000/success',
  cancelUrl: 'http://localhost:3000/cancel',
};

/**
 * A mocked Stripe create call's (params, options). `create` is overloaded, and
 * the mock types its calls by the last overload, `[options?]`.
 */
function callOf<P>(
  fn: unknown,
  index: number
): [P | undefined, Stripe.RequestOptions | undefined] {
  const calls = (fn as { mock: { calls: unknown[][] } }).mock.calls;
  return (calls[index] ?? []) as [
    P | undefined,
    Stripe.RequestOptions | undefined,
  ];
}

describe('PurchaseService — checkout correctness (Codex-2hxff.14)', () => {
  let db: Database;
  let creatorId: string;
  let organizationId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId] = await seedTestUsers(db, 1);
    const org = takeFirst(
      await db
        .insert(schema.organizations)
        .values(createTestOrganizationInput())
        .returning()
    );
    organizationId = org.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  function fresh() {
    const stripe = createMockStripe();
    return {
      stripe,
      service: new PurchaseService({ db, environment: 'test' }, stripe),
    };
  }

  /** A buyer whose Stripe Customer is cached, so checkout resolves none. */
  async function buyer(): Promise<string> {
    const id = takeFirst(await seedTestUsers(db, 1));
    await db
      .update(schema.users)
      .set({ stripeCustomerId: `cus_test_${crypto.randomUUID()}` })
      .where(eq(schema.users.id, id));
    return id;
  }

  /** Published content for sale at £15 unless the flags say otherwise. */
  async function insertContent(
    flags: Partial<typeof schema.content.$inferInsert> = {}
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
          title: `Sellable ${crypto.randomUUID().slice(0, 8)}`,
          slug: createUniqueSlug('sellable'),
          contentType: 'video',
          status: 'published',
          isPurchasable: true,
          priceCents: 1500,
          ...flags,
        })
        .returning()
    );
  }

  async function insertCourse() {
    return takeFirst(
      await db
        .insert(schema.courses)
        .values({
          organizationId,
          creatorId,
          slug: createUniqueSlug('sellable-course'),
          title: 'Sellable course',
          status: 'published',
          priceCents: 4999,
        })
        .returning()
    );
  }

  async function sessionsFor(customerId: string) {
    return db
      .select()
      .from(schema.checkoutSessions)
      .where(eq(schema.checkoutSessions.customerId, customerId));
  }

  describe('what checkout sells', () => {
    it.each([
      ['not marked purchasable', { isPurchasable: false }],
      ['course-only', { courseOnly: true }],
      ['team-only', { isTeamOnly: true }],
      ['followers-only', { isFollowerGated: true }],
    ])('refuses priced %s content: a purchase would not open it', async (_s, flags) => {
      const { service, stripe } = fresh();
      const item = await insertContent(flags);
      const customerId = await buyer();

      const refused = await service
        .createCheckoutSession({ contentId: item.id, ...URLS }, customerId)
        .catch((e: unknown) => e);

      expect(refused).toBeInstanceOf(ContentNotPurchasableError);
      expect((refused as ContentNotPurchasableError).context).toMatchObject({
        reason: 'not_sold_separately',
      });
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
      expect(await sessionsFor(customerId)).toHaveLength(0);
    });

    it('sells sellable content: a 31-minute session under a per-reservation key', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent();
      const customerId = await buyer();
      const before = Date.now();

      const result = await service.createCheckoutSession(
        { contentId: item.id, ...URLS },
        customerId
      );

      const [params, options] = callOf<Stripe.Checkout.SessionCreateParams>(
        stripe.checkout.sessions.create,
        0
      );
      const expiresAtMs = (params?.expires_at ?? 0) * 1000;
      // Stripe refuses under 30 minutes after ITS creation; ours is 31.
      expect(expiresAtMs - before).toBeGreaterThanOrEqual(30.5 * 60 * 1000);
      expect(expiresAtMs - before).toBeLessThanOrEqual(32 * 60 * 1000);

      const [row] = await sessionsFor(customerId);
      expect(row).toMatchObject({
        contentId: item.id,
        amountCents: 1500,
        status: CHECKOUT_SESSION_STATUS.OPEN,
        stripeSessionId: result.sessionId,
        url: result.sessionUrl,
      });
      expect(options?.idempotencyKey).toMatch(
        new RegExp(`^checkout_${row?.id}_cus_test_`)
      );
    });
  });

  describe('one open checkout per buyer and item', () => {
    it('a second tab gets the first tab’s Stripe page, not a second session', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent();
      const customerId = await buyer();

      const first = await service.createCheckoutSession(
        { contentId: item.id, ...URLS },
        customerId
      );
      const second = await service.createCheckoutSession(
        { contentId: item.id, ...URLS },
        customerId
      );

      expect(second).toEqual(first);
      expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
      expect(await sessionsFor(customerId)).toHaveLength(1);
    });

    it('two tabs at once share one reservation and, through its key, one session', async () => {
      const { service, stripe } = fresh();
      // Stripe's idempotency: a key it has seen returns the same session.
      const byKey = new Map<string, Stripe.Checkout.Session>();
      vi.mocked(stripe.checkout.sessions.create).mockImplementation((async (
        _params: unknown,
        options?: { idempotencyKey?: string }
      ) => {
        const key = options?.idempotencyKey ?? crypto.randomUUID();
        let session = byKey.get(key);
        if (!session) {
          const id = `cs_test_${crypto.randomUUID()}`;
          session = {
            id,
            url: `https://checkout.stripe.com/pay/${id}`,
          } as Stripe.Checkout.Session;
          byKey.set(key, session);
        }
        return session;
      }) as never);
      const item = await insertContent();
      const customerId = await buyer();

      const [a, b] = await Promise.all([
        service.createCheckoutSession(
          { contentId: item.id, ...URLS },
          customerId
        ),
        service.createCheckoutSession(
          { contentId: item.id, ...URLS },
          customerId
        ),
      ]);

      expect(a.sessionUrl).toBe(b.sessionUrl);
      expect(byKey.size).toBe(1);
      const open = (await sessionsFor(customerId)).filter(
        (r) => r.status === CHECKOUT_SESSION_STATUS.OPEN
      );
      expect(open).toHaveLength(1);
    });

    it('a price change replaces the open session and expires the old one at Stripe', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent();
      const customerId = await buyer();

      const first = await service.createCheckoutSession(
        { contentId: item.id, ...URLS },
        customerId
      );
      await db
        .update(schema.content)
        .set({ priceCents: 2000 })
        .where(eq(schema.content.id, item.id));
      const second = await service.createCheckoutSession(
        { contentId: item.id, ...URLS },
        customerId
      );

      expect(second.sessionId).not.toBe(first.sessionId);
      expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
        first.sessionId
      );
      const rows = await sessionsFor(customerId);
      expect(
        rows.find((r) => r.stripeSessionId === first.sessionId)?.status
      ).toBe(CHECKOUT_SESSION_STATUS.EXPIRED);
      expect(
        rows.find((r) => r.stripeSessionId === second.sessionId)
      ).toMatchObject({
        status: CHECKOUT_SESSION_STATUS.OPEN,
        amountCents: 2000,
      });
    });

    it('a session about to expire is replaced, not handed out', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent();
      const customerId = await buyer();

      const first = await service.createCheckoutSession(
        { contentId: item.id, ...URLS },
        customerId
      );
      await db
        .update(schema.checkoutSessions)
        .set({ expiresAt: new Date(Date.now() + 2 * 60 * 1000) })
        .where(eq(schema.checkoutSessions.stripeSessionId, first.sessionId));
      const second = await service.createCheckoutSession(
        { contentId: item.id, ...URLS },
        customerId
      );

      expect(second.sessionId).not.toBe(first.sessionId);
      expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    });

    it('a failed Stripe call frees the reservation, so the retry starts afresh', async () => {
      const { service, stripe } = fresh();
      vi.mocked(stripe.checkout.sessions.create).mockRejectedValueOnce(
        Object.assign(new Error('Stripe is down'), {
          type: 'StripeAPIError',
          statusCode: 500,
        })
      );
      const item = await insertContent();
      const customerId = await buyer();

      await expect(
        service.createCheckoutSession(
          { contentId: item.id, ...URLS },
          customerId
        )
      ).rejects.toBeInstanceOf(PaymentProcessingError);
      const [failed] = await sessionsFor(customerId);
      expect(failed?.status).toBe(CHECKOUT_SESSION_STATUS.EXPIRED);

      const retried = await service.createCheckoutSession(
        { contentId: item.id, ...URLS },
        customerId
      );
      expect(retried.sessionUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
      const [, retryOptions] = callOf<Stripe.Checkout.SessionCreateParams>(
        stripe.checkout.sessions.create,
        1
      );
      expect(retryOptions?.idempotencyKey).not.toContain(failed?.id);
    });

    it('marks the paid session completed', async () => {
      const { service } = fresh();
      const item = await insertContent();
      const customerId = await buyer();
      const { sessionId } = await service.createCheckoutSession(
        { contentId: item.id, ...URLS },
        customerId
      );

      await service.markCheckoutSessionCompleted(sessionId);

      const [row] = await sessionsFor(customerId);
      expect(row?.status).toBe(CHECKOUT_SESSION_STATUS.COMPLETED);
    });

    // The other tab of a double click is creating the session under the same
    // key: Stripe answers 409 while it runs, or an idempotency error when its
    // parameters differ (another entry point's cancel URL). This tab waits for
    // the other's session instead of failing.
    it.each([
      ['409 (still running)', { statusCode: 409 }],
      [
        'an idempotency error (different parameters)',
        { statusCode: 400, type: 'StripeIdempotencyError' },
      ],
    ])('on %s, waits for the other tab’s session and returns it', async (_c, shape) => {
      const { service, stripe } = fresh();
      const item = await insertContent();
      const customerId = await buyer();
      const otherTab = `cs_test_${crypto.randomUUID()}`;
      vi.mocked(stripe.checkout.sessions.create).mockImplementationOnce(
        (async () => {
          // The other tab records its session meanwhile.
          await db
            .update(schema.checkoutSessions)
            .set({
              stripeSessionId: otherTab,
              url: `https://checkout.stripe.com/pay/${otherTab}`,
            })
            .where(eq(schema.checkoutSessions.customerId, customerId));
          throw Object.assign(new Error('concurrent'), shape);
        }) as never
      );

      const result = await service.createCheckoutSession(
        { contentId: item.id, ...URLS },
        customerId
      );

      expect(result).toEqual({
        sessionId: otherTab,
        sessionUrl: `https://checkout.stripe.com/pay/${otherTab}`,
      });
      const [row] = await sessionsFor(customerId);
      expect(row?.status).toBe(CHECKOUT_SESSION_STATUS.OPEN);
    });

    it('a reservation whose creator never finished is replaced, not reused', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent();
      const customerId = await buyer();
      // Open, no session yet, made two minutes ago: its creator failed.
      const [stale] = await db
        .insert(schema.checkoutSessions)
        .values({
          customerId,
          contentId: item.id,
          amountCents: 1500,
          expiresAt: new Date(Date.now() + 29 * 60 * 1000),
          createdAt: new Date(Date.now() - 2 * 60 * 1000),
        })
        .returning();

      await service.createCheckoutSession(
        { contentId: item.id, ...URLS },
        customerId
      );

      const [, options] = callOf<Stripe.Checkout.SessionCreateParams>(
        stripe.checkout.sessions.create,
        0
      );
      expect(options?.idempotencyKey).not.toContain(stale?.id);
      const rows = await sessionsFor(customerId);
      expect(rows.find((r) => r.id === stale?.id)?.status).toBe(
        CHECKOUT_SESSION_STATUS.EXPIRED
      );
    });
  });

  describe('who already owns a course', () => {
    async function entitle(
      userId: string,
      courseId: string,
      source: 'grant' | 'course_subscription'
    ) {
      await db.insert(schema.entitlements).values({
        userId,
        organizationId,
        courseId,
        source,
      });
    }

    it('a support grant owns it: no checkout', async () => {
      const { service } = fresh();
      const course = await insertCourse();
      const customerId = await buyer();
      await entitle(customerId, course.id, 'grant');

      await expect(
        service.createCourseCheckoutSession(
          { courseId: course.id, ...URLS },
          customerId
        )
      ).rejects.toBeInstanceOf(CourseAlreadyOwnedError);
    });

    it('a course plan subscriber rents it, so may still buy it outright', async () => {
      const { service } = fresh();
      const course = await insertCourse();
      const customerId = await buyer();
      await entitle(customerId, course.id, 'course_subscription');

      const result = await service.createCourseCheckoutSession(
        { courseId: course.id, ...URLS },
        customerId
      );
      expect(result.sessionUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    });
  });

  describe('a second payment for an owned item', () => {
    function complete(
      service: PurchaseService,
      pi: string,
      customerId: string,
      contentId: string,
      stripeChargeId?: string
    ) {
      return service.completePurchase(pi, {
        customerId,
        contentId,
        organizationId,
        amountPaidCents: 1500,
        currency: 'gbp',
        stripeChargeId,
      });
    }

    it('is recorded as a duplicate, grants and pays nothing, and is refunded in full', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent();
      const customerId = await buyer();
      const firstPi = `pi_first_${crypto.randomUUID()}`;
      const secondPi = `pi_dup_${crypto.randomUUID()}`;

      const first = await complete(service, firstPi, customerId, item.id);
      const second = await complete(
        service,
        secondPi,
        customerId,
        item.id,
        `ch_dup_${crypto.randomUUID()}`
      );

      expect(first.status).toBe('completed');
      expect(second).toMatchObject({
        status: 'refunded',
        duplicateOfPurchaseId: first.id,
        refundAmountCents: 1500,
      });
      expect(second.refundedAt).not.toBeNull();
      expect(second.stripeRefundId).toMatch(/^re_/);
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_intent: secondPi,
          reason: 'duplicate',
        }),
        { idempotencyKey: `refund_duplicate_${secondPi}` }
      );

      // No slice for the duplicate's charge, though it carried one.
      const slices = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, second.id));
      expect(slices).toHaveLength(0);
      // One live grant: the first purchase's.
      const grants = await db
        .select()
        .from(schema.entitlements)
        .where(
          and(
            eq(schema.entitlements.userId, customerId),
            eq(schema.entitlements.contentId, item.id),
            isNull(schema.entitlements.revokedAt)
          )
        );
      expect(grants.map((g) => g.sourceRef)).toEqual([first.id]);
      // No sale either: the creator's Sales list the first purchase only.
      const sales = await service.listSales(organizationId, {
        page: 1,
        limit: 100,
      });
      const ids = sales.items.map((sale) => sale.id);
      expect(ids).toContain(first.id);
      expect(ids).not.toContain(second.id);
    });

    it('a refund Stripe refuses leaves it pending (owed, not returned) and retryable; the retry refunds it', async () => {
      const { service, stripe } = fresh();
      vi.mocked(stripe.refunds.create).mockRejectedValueOnce(
        Object.assign(new Error('The charge is disputed.'), {
          type: 'StripeInvalidRequestError',
          code: 'charge_disputed',
          statusCode: 400,
        })
      );
      const item = await insertContent();
      const customerId = await buyer();
      const secondPi = `pi_dup_refused_${crypto.randomUUID()}`;
      const first = await complete(
        service,
        `pi_first_${crypto.randomUUID()}`,
        customerId,
        item.id
      );

      // Retryable whatever Stripe's reason, so the webhook answers 500.
      await expect(
        complete(service, secondPi, customerId, item.id)
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
      const [held] = await db
        .select()
        .from(schema.purchases)
        .where(eq(schema.purchases.stripePaymentIntentId, secondPi));
      expect(held).toMatchObject({
        status: 'pending',
        duplicateOfPurchaseId: first.id,
        refundedAt: null,
        refundAmountCents: null,
      });

      // Stripe's redelivery: the refund goes through this time.
      const retried = await complete(service, secondPi, customerId, item.id);
      expect(retried.status).toBe('refunded');
      expect(stripe.refunds.create).toHaveBeenCalledTimes(2);
    });

    it('the hourly sweep leaves a fresh owed refund to the webhook, reports one Stripe still refuses, and settles it once Stripe accepts', async () => {
      const { service, stripe } = fresh();
      const refusal = Object.assign(new Error('The charge is disputed.'), {
        type: 'StripeInvalidRequestError',
        code: 'charge_disputed',
        statusCode: 400,
      });
      const item = await insertContent();
      const customerId = await buyer();
      const owedPi = `pi_dup_owed_${crypto.randomUUID()}`;
      await complete(
        service,
        `pi_first_${crypto.randomUUID()}`,
        customerId,
        item.id
      );
      vi.mocked(stripe.refunds.create).mockRejectedValueOnce(refusal);
      await expect(
        complete(service, owedPi, customerId, item.id)
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
      const owedRow = async () =>
        (
          await db
            .select()
            .from(schema.purchases)
            .where(eq(schema.purchases.stripePaymentIntentId, owedPi))
        )[0];

      // Within the hour Stripe is still redelivering: not the sweep's.
      const early = await service.settleOwedDuplicates({
        olderThanMs: 60 * 60 * 1000,
        limit: 1000,
      });
      expect(early.stillOwed.map((o) => o.stripePaymentIntentId)).not.toContain(
        owedPi
      );
      expect((await owedRow())?.status).toBe('pending');

      // Past it, Stripe still refusing: reported, still owed.
      vi.mocked(stripe.refunds.create).mockRejectedValue(refusal);
      const refused = await service.settleOwedDuplicates({
        olderThanMs: 0,
        limit: 1000,
      });
      expect(refused.stillOwed.map((o) => o.stripePaymentIntentId)).toContain(
        owedPi
      );
      expect((await owedRow())?.status).toBe('pending');

      // Stripe accepts: refunded, and no longer owed.
      vi.mocked(stripe.refunds.create).mockResolvedValue({
        id: `re_sweep_${crypto.randomUUID()}`,
      } as never);
      const swept = await service.settleOwedDuplicates({
        olderThanMs: 0,
        limit: 1000,
      });
      expect(swept.stillOwed.map((o) => o.stripePaymentIntentId)).not.toContain(
        owedPi
      );
      expect(await owedRow()).toMatchObject({
        status: 'refunded',
        refundAmountCents: 1500,
      });
    });

    it('two concurrent deliveries of the same payment complete it once, with no false duplicate', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent();
      const customerId = await buyer();
      const pi = `pi_concurrent_${crypto.randomUUID()}`;

      // The second waits on the lock, then finds the first's row by its
      // PaymentIntent instead of taking it for an owned purchase.
      const [a, b] = await Promise.all([
        complete(service, pi, customerId, item.id),
        complete(service, pi, customerId, item.id),
      ]);

      expect(a.id).toBe(b.id);
      expect(a.status).toBe('completed');
      expect(stripe.refunds.create).not.toHaveBeenCalled();
      const rows = await db
        .select()
        .from(schema.purchases)
        .where(eq(schema.purchases.stripePaymentIntentId, pi));
      expect(rows).toHaveLength(1);
    });

    it('a replay after the refund asks Stripe nothing more and pays no one', async () => {
      const { service, stripe } = fresh();
      const item = await insertContent();
      const customerId = await buyer();
      const secondPi = `pi_dup_replay_${crypto.randomUUID()}`;
      const charge = `ch_dup_replay_${crypto.randomUUID()}`;

      await complete(
        service,
        `pi_first_${crypto.randomUUID()}`,
        customerId,
        item.id
      );
      const second = await complete(
        service,
        secondPi,
        customerId,
        item.id,
        charge
      );
      const replay = await complete(
        service,
        secondPi,
        customerId,
        item.id,
        charge
      );

      expect(replay.id).toBe(second.id);
      expect(replay.status).toBe('refunded');
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      const slices = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, second.id));
      expect(slices).toHaveLength(0);
    });

    it('its charge.refunded keeps the buyer’s access, says it was a duplicate, and names the item', async () => {
      const { service } = fresh();
      const item = await insertContent();
      const customerId = await buyer();
      const secondPi = `pi_dup_refund_${crypto.randomUUID()}`;

      await complete(
        service,
        `pi_first_${crypto.randomUUID()}`,
        customerId,
        item.id
      );
      await complete(service, secondPi, customerId, item.id);

      const result = await service.processRefund(secondPi, {
        charge: { id: `ch_${crypto.randomUUID()}`, amountCents: 1500 },
        refundAmountCents: 1500,
      });

      expect(result).toEqual({
        userId: customerId,
        accessEnded: false,
        duplicatePayment: true,
        itemTitle: item.title,
      });
      const [access] = await db
        .select()
        .from(schema.contentAccess)
        .where(
          and(
            eq(schema.contentAccess.userId, customerId),
            eq(schema.contentAccess.contentId, item.id)
          )
        );
      expect(access?.deletedAt).toBeNull();
    });

    it('a dispute of the duplicate keeps the buyer’s access and asks for no streaming block', async () => {
      const { service } = fresh();
      const item = await insertContent();
      const customerId = await buyer();
      const secondPi = `pi_dup_dispute_${crypto.randomUUID()}`;

      await complete(
        service,
        `pi_first_${crypto.randomUUID()}`,
        customerId,
        item.id
      );
      await complete(service, secondPi, customerId, item.id);

      const opened = await service.processDispute(secondPi, {
        stripeDisputeId: `dp_${crypto.randomUUID()}`,
      });
      const lost = await service.processLostDispute(secondPi, 1500);

      expect(opened?.accessEnded).toBe(false);
      expect(lost?.accessEnded).toBe(false);
      const [access] = await db
        .select()
        .from(schema.contentAccess)
        .where(
          and(
            eq(schema.contentAccess.userId, customerId),
            eq(schema.contentAccess.contentId, item.id)
          )
        );
      expect(access?.deletedAt).toBeNull();
    });

    it('a course bought twice: the second is refunded, one live entitlement', async () => {
      const { service, stripe } = fresh();
      const course = await insertCourse();
      const customerId = await buyer();
      const pay = (pi: string) =>
        service.completeCoursePurchase(pi, {
          customerId,
          courseId: course.id,
          amountPaidCents: 4999,
          currency: 'gbp',
        });

      const first = await pay(`pi_course_first_${crypto.randomUUID()}`);
      const second = await pay(`pi_course_dup_${crypto.randomUUID()}`);

      expect(second).toMatchObject({
        status: 'refunded',
        duplicateOfPurchaseId: first.id,
      });
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      const live = await db
        .select()
        .from(schema.entitlements)
        .where(
          and(
            eq(schema.entitlements.userId, customerId),
            eq(schema.entitlements.courseId, course.id),
            eq(schema.entitlements.source, 'course_purchase'),
            isNull(schema.entitlements.revokedAt)
          )
        );
      expect(live).toHaveLength(1);
    });
  });

  describe('a refund or dispute of one purchase spares a later one', () => {
    it('a dispute on a refunded purchase leaves the re-purchase’s access', async () => {
      const { service } = fresh();
      const item = await insertContent();
      const customerId = await buyer();
      const firstPi = `pi_old_${crypto.randomUUID()}`;

      await service.completePurchase(firstPi, {
        customerId,
        contentId: item.id,
        organizationId,
        amountPaidCents: 1500,
        currency: 'gbp',
      });
      await service.processRefund(firstPi, {
        charge: { id: `ch_${crypto.randomUUID()}`, amountCents: 1500 },
        refundAmountCents: 1500,
      });
      // Bought again after the refund: a sale, not a duplicate.
      const again = await service.completePurchase(
        `pi_again_${crypto.randomUUID()}`,
        {
          customerId,
          contentId: item.id,
          organizationId,
          amountPaidCents: 1500,
          currency: 'gbp',
        }
      );
      expect(again.status).toBe('completed');

      const disputed = await service.processDispute(firstPi, {
        stripeDisputeId: `dp_${crypto.randomUUID()}`,
      });

      expect(disputed?.accessEnded).toBe(false);
      const [access] = await db
        .select()
        .from(schema.contentAccess)
        .where(
          and(
            eq(schema.contentAccess.userId, customerId),
            eq(schema.contentAccess.contentId, item.id)
          )
        );
      expect(access?.deletedAt).toBeNull();
    });
  });

  it('self-heal rebuilds an owned item’s second payment as the duplicate it is, and its refund keeps access', async () => {
    const { service, stripe } = fresh();
    const item = await insertContent();
    // The self-heal parses session metadata with the webhook's schema, whose
    // userIdSchema is alphanumeric (BetterAuth ids); seeded test ids are not.
    const customerId = `custdup${crypto.randomUUID().replace(/-/g, '')}`;
    await db.insert(schema.users).values({
      id: customerId,
      name: 'Duplicate self-heal buyer',
      email: `dup-heal-${customerId}@example.com`,
      emailVerified: true,
      role: 'customer',
    });
    const first = await service.completePurchase(
      `pi_first_${crypto.randomUUID()}`,
      {
        customerId,
        contentId: item.id,
        organizationId,
        amountPaidCents: 1500,
        currency: 'gbp',
      }
    );
    const earlyPi = `pi_early_refund_${crypto.randomUUID()}`;
    stripe.checkout.sessions.list = vi.fn().mockResolvedValue({
      data: [
        {
          id: `cs_${crypto.randomUUID()}`,
          amount_total: 1500,
          metadata: { customerId, contentId: item.id, organizationId },
        },
      ],
    }) as never;

    const result = await service.processRefund(earlyPi, {
      charge: { id: `ch_${crypto.randomUUID()}`, amountCents: 1500 },
      refundAmountCents: 1500,
    });

    expect(result).toMatchObject({
      accessEnded: false,
      duplicatePayment: true,
    });
    const [rebuilt] = await db
      .select()
      .from(schema.purchases)
      .where(eq(schema.purchases.stripePaymentIntentId, earlyPi));
    expect(rebuilt).toMatchObject({
      status: 'refunded',
      duplicateOfPurchaseId: first.id,
    });
  });
});
