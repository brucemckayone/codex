/**
 * What a purchase records, what it refuses, and what its errors tell the
 * client.
 *
 * - Codex-2hxff.19 AGR-06: a content or course purchase made under a creator
 *   agreement stores that agreement on the purchase
 *   (`creator_org_agreement_id`) and on its creator slice; without one both
 *   stay null. `platform_agreement_id` stays null: fee configuration replaced
 *   platform agreements.
 * - Codex-2hxff.23 PAY-25: a sale in any currency but GBP is refused with
 *   `UnsupportedCurrencyError` (400, permanent) before its purchase or any
 *   slice is written, so no transfer is ever created.
 * - Codex-2hxff.23 SEC-02: a ServiceError's context is sent to the client
 *   verbatim (`details`), so Stripe's own message never goes in it. It is
 *   logged with an errorId, and the client gets the errorId.
 *
 * Real DB, mocked Stripe. The local database is shared with other sessions:
 * every row hangs off this file's own organisations and users and is deleted
 * in afterAll.
 */

import { randomUUID } from 'node:crypto';
import * as schema from '@codex/database/schema';
import {
  mapErrorToResponse,
  ServiceError,
  UnsupportedCurrencyError,
} from '@codex/service-errors';
import {
  createMockStripe,
  createTestConnectAccountInput,
  createTestMediaItemInput,
  createTestMoneyDeps,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PurchaseService } from '../services/purchase-service';

/** Stripe's own words, which must never reach a client. */
const STRIPE_SECRET_MESSAGE = 'Internal detail for acct_1Secret: key sk_live_x';

function stripeFailure(type: string): Error {
  return Object.assign(new Error(STRIPE_SECRET_MESSAGE), {
    type,
    code: 'api_error',
  });
}

describe('purchase records, currency and client-facing errors', () => {
  let db: Database;
  let stripe: Stripe;
  let service: PurchaseService;
  let creatorId: string;
  let buyerId: string;
  const orgIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    stripe = createMockStripe();
    // The two calls the error tests fail, which the shared mock lacks.
    Object.assign(stripe.checkout.sessions, { retrieve: vi.fn() });
    Object.assign(stripe, { billingPortal: { sessions: { create: vi.fn() } } });
    service = new PurchaseService(
      {
        db,
        environment: 'test',
        ...createTestMoneyDeps(),
        portalConfigurationId: 'bpc_test_locked_portal',
      },
      stripe
    );
    [creatorId] = await seedTestUsers(db, 1);
    // A cached Customer id, so checkout and the portal never look one up.
    [buyerId] = await seedTestUsers(db, 1, {
      stripeCustomerId: `cus_test_${randomUUID().slice(0, 8)}`,
    });
    userIds.push(creatorId, buyerId);
    // A creator who can be paid: a GBP sale transfers their slice.
    await db
      .insert(schema.stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, creatorId));
  });

  afterAll(async () => {
    const purchaseIds = (
      await db
        .select({ id: schema.purchases.id })
        .from(schema.purchases)
        .where(inArray(schema.purchases.customerId, userIds))
    ).map((p) => p.id);
    if (purchaseIds.length > 0) {
      await db
        .delete(schema.payouts)
        .where(inArray(schema.payouts.purchaseId, purchaseIds));
    }
    await db
      .delete(schema.entitlements)
      .where(inArray(schema.entitlements.userId, userIds));
    await db
      .delete(schema.courseEnrollments)
      .where(inArray(schema.courseEnrollments.userId, userIds));
    await db
      .delete(schema.contentAccess)
      .where(inArray(schema.contentAccess.userId, userIds));
    await db
      .delete(schema.purchases)
      .where(inArray(schema.purchases.customerId, userIds));
    if (orgIds.length > 0) {
      await db
        .delete(schema.creatorOrganizationAgreements)
        .where(
          inArray(schema.creatorOrganizationAgreements.organizationId, orgIds)
        );
      await db
        .delete(schema.agreementProposals)
        .where(inArray(schema.agreementProposals.organizationId, orgIds));
      await db
        .delete(schema.content)
        .where(inArray(schema.content.organizationId, orgIds));
      await db
        .delete(schema.courses)
        .where(inArray(schema.courses.organizationId, orgIds));
    }
    await db
      .delete(schema.mediaItems)
      .where(inArray(schema.mediaItems.creatorId, userIds));
    await db
      .delete(schema.stripeConnectAccounts)
      .where(inArray(schema.stripeConnectAccounts.userId, userIds));
    if (orgIds.length > 0) {
      await db
        .delete(schema.organizations)
        .where(inArray(schema.organizations.id, orgIds));
    }
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    await teardownTestDatabase();
  });

  /** An organisation selling one video and one course by the creator. */
  async function shop(options: { agreementShare?: number } = {}) {
    const org = takeFirst(
      await db
        .insert(schema.organizations)
        .values({ name: 'Records Org', slug: createUniqueSlug('pur-rec') })
        .returning()
    );
    orgIds.push(org.id);
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
    const item = takeFirst(
      await db
        .insert(schema.content)
        .values({
          creatorId,
          organizationId: org.id,
          mediaItemId: media.id,
          title: 'Records video',
          slug: createUniqueSlug('pur-rec-video'),
          contentType: 'video',
          status: 'published',
          priceCents: 10_000,
          isPurchasable: true,
        })
        .returning()
    );
    const course = takeFirst(
      await db
        .insert(schema.courses)
        .values({
          organizationId: org.id,
          creatorId,
          slug: createUniqueSlug('pur-rec-course'),
          title: 'Records course',
          status: 'published',
          priceCents: 10_000,
        })
        .returning()
    );

    let agreementId: string | null = null;
    if (options.agreementShare !== undefined) {
      const effectiveFrom = new Date(Date.now() - 86_400_000);
      const proposal = takeFirst(
        await db
          .insert(schema.agreementProposals)
          .values({
            organizationId: org.id,
            creatorId,
            revenueType: 'content_purchase',
            roundNumber: 1,
            proposedByUserId: creatorId,
            proposedByRole: 'owner',
            proposedCreatorSharePercent: options.agreementShare,
            proposedEffectiveFrom: effectiveFrom,
            status: 'accepted',
          })
          .returning()
      );
      const agreement = takeFirst(
        await db
          .insert(schema.creatorOrganizationAgreements)
          .values({
            organizationId: org.id,
            creatorId,
            organizationFeePercentage: 10_000 - options.agreementShare,
            revenueType: 'content_purchase',
            status: 'active',
            currentProposalId: proposal.id,
            effectiveFrom,
          })
          .returning()
      );
      agreementId = agreement.id;
    }
    return {
      orgId: org.id,
      contentId: item.id,
      courseId: course.id,
      agreementId,
    };
  }

  const ids = () => ({
    paymentIntentId: `pi_rec_${randomUUID().slice(0, 12)}`,
    chargeId: `ch_rec_${randomUUID().slice(0, 12)}`,
  });

  /** The purchase's creator slice. */
  async function creatorSlice(purchaseId: string) {
    const rows = await db
      .select()
      .from(schema.payouts)
      .where(eq(schema.payouts.purchaseId, purchaseId));
    return rows.find((r) => r.payoutType === 'creator_payout');
  }

  describe('the agreement a purchase used (AGR-06)', () => {
    it('a content purchase under an agreement stores it, on the purchase and its creator slice', async () => {
      const fx = await shop({ agreementShare: 7000 });
      const { paymentIntentId, chargeId } = ids();

      const purchase = await service.completePurchase(paymentIntentId, {
        customerId: buyerId,
        contentId: fx.contentId,
        organizationId: fx.orgId,
        amountPaidCents: 10_000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });

      expect(fx.agreementId).not.toBeNull();
      expect(purchase.creatorOrgAgreementId).toBe(fx.agreementId);
      expect(purchase.platformAgreementId).toBeNull();
      // 10% platform, then the creator's 70% of the 9000 left.
      expect(purchase.creatorPayoutCents).toBe(6300);
      expect((await creatorSlice(purchase.id))?.creatorOrgAgreementId).toBe(
        fx.agreementId
      );
    });

    it('a course purchase under an agreement stores it', async () => {
      const fx = await shop({ agreementShare: 6000 });
      const { paymentIntentId, chargeId } = ids();

      const purchase = await service.completeCoursePurchase(paymentIntentId, {
        customerId: buyerId,
        courseId: fx.courseId,
        amountPaidCents: 10_000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });

      expect(purchase.creatorOrgAgreementId).toBe(fx.agreementId);
      expect(purchase.platformAgreementId).toBeNull();
      expect((await creatorSlice(purchase.id))?.creatorOrgAgreementId).toBe(
        fx.agreementId
      );
    });

    it('without an agreement, content and course purchases store none', async () => {
      const fx = await shop();

      const content = await service.completePurchase(ids().paymentIntentId, {
        customerId: buyerId,
        contentId: fx.contentId,
        organizationId: fx.orgId,
        amountPaidCents: 10_000,
        currency: 'gbp',
        stripeChargeId: ids().chargeId,
      });
      const course = await service.completeCoursePurchase(
        ids().paymentIntentId,
        {
          customerId: buyerId,
          courseId: fx.courseId,
          amountPaidCents: 10_000,
          currency: 'gbp',
          stripeChargeId: ids().chargeId,
        }
      );

      expect(content.creatorOrgAgreementId).toBeNull();
      expect(course.creatorOrgAgreementId).toBeNull();
      expect(
        (await creatorSlice(content.id))?.creatorOrgAgreementId
      ).toBeNull();
    });
  });

  describe('GBP only (PAY-25)', () => {
    it('a GBP sale transfers the creator slice (the control)', async () => {
      const fx = await shop();
      const transfers = vi.mocked(stripe.transfers.create);
      transfers.mockClear();

      await service.completePurchase(ids().paymentIntentId, {
        customerId: buyerId,
        contentId: fx.contentId,
        organizationId: fx.orgId,
        amountPaidCents: 10_000,
        currency: 'gbp',
        stripeChargeId: ids().chargeId,
      });

      expect(transfers).toHaveBeenCalled();
    });

    it.each([
      ['content', 'usd'],
      ['course', 'usd'],
      ['content', 'EUR'],
    ] as const)('a %s sale in %s is refused before anything is written', async (kind, currency) => {
      const fx = await shop({ agreementShare: 7000 });
      const { paymentIntentId, chargeId } = ids();
      const transfers = vi.mocked(stripe.transfers.create);
      transfers.mockClear();

      const sale =
        kind === 'content'
          ? service.completePurchase(paymentIntentId, {
              customerId: buyerId,
              contentId: fx.contentId,
              organizationId: fx.orgId,
              amountPaidCents: 10_000,
              currency,
              stripeChargeId: chargeId,
            })
          : service.completeCoursePurchase(paymentIntentId, {
              customerId: buyerId,
              courseId: fx.courseId,
              amountPaidCents: 10_000,
              currency,
              stripeChargeId: chargeId,
            });

      const error = await sale.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnsupportedCurrencyError);
      // A 400: the webhook acknowledges it, and Stripe does not redeliver.
      expect((error as ServiceError).statusCode).toBe(400);
      expect(transfers).not.toHaveBeenCalled();
      const written = await db
        .select({ id: schema.purchases.id })
        .from(schema.purchases)
        .where(eq(schema.purchases.stripePaymentIntentId, paymentIntentId));
      expect(written).toHaveLength(0);
      const slices = await db
        .select({ id: schema.payouts.id })
        .from(schema.payouts)
        .where(eq(schema.payouts.stripeChargeId, chargeId));
      expect(slices).toHaveLength(0);
    });
  });

  describe("Stripe's message stays out of client-facing errors (SEC-02)", () => {
    /**
     * The error carries an errorId and never Stripe's message; the service's
     * log keeps Stripe's message under that errorId. What reaches the client
     * is `mapErrorToResponse`'s body: a 4xx sends the errorId as `details`,
     * and a 5xx sends no details at all, its context logged by the mapper
     * instead (Codex-adcgb).
     */
    async function expectOnlyAnErrorId(
      run: () => Promise<unknown>,
      level: 'error' | 'warn' = 'error'
    ) {
      const obs = (
        service as unknown as { obs: { error: () => void; warn: () => void } }
      ).obs;
      const logged = vi.spyOn(obs, level);
      const other = vi.spyOn(obs, level === 'error' ? 'warn' : 'error');
      const mapperObs = { error: vi.fn(), warn: vi.fn() };
      try {
        const error = await run().then(
          () => {
            throw new Error('expected a failure');
          },
          (e: unknown) => e
        );
        expect(error).toBeInstanceOf(ServiceError);
        const { context, statusCode } = error as ServiceError;
        expect(JSON.stringify(context)).not.toContain(STRIPE_SECRET_MESSAGE);
        expect(context).not.toHaveProperty('stripeError');
        expect(context).not.toHaveProperty('stripeMessage');
        const errorId = context?.errorId;
        expect(errorId).toEqual(expect.any(String));

        const { response } = mapErrorToResponse(error, {
          obs: mapperObs as never,
        });
        expect(JSON.stringify(response)).not.toContain(STRIPE_SECRET_MESSAGE);
        if (statusCode < 500) {
          expect(response.error.details).toMatchObject({ errorId });
        } else {
          expect(response.error).not.toHaveProperty('details');
          const withheld = [
            ...mapperObs.error.mock.calls,
            ...mapperObs.warn.mock.calls,
          ];
          expect(JSON.stringify(withheld)).toContain(String(errorId));
          expect(JSON.stringify(withheld)).not.toContain(STRIPE_SECRET_MESSAGE);
        }

        expect(logged).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ errorId, error: STRIPE_SECRET_MESSAGE })
        );
        expect(other).not.toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ errorId })
        );
      } finally {
        logged.mockRestore();
        other.mockRestore();
      }
    }

    it('creating a content checkout session', async () => {
      const fx = await shop();
      vi.mocked(stripe.checkout.sessions.create).mockRejectedValueOnce(
        stripeFailure('StripeAPIError')
      );
      await expectOnlyAnErrorId(() =>
        service.createCheckoutSession(
          {
            contentId: fx.contentId,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          },
          buyerId
        )
      );
    });

    it('creating a course checkout session', async () => {
      const fx = await shop();
      vi.mocked(stripe.checkout.sessions.create).mockRejectedValueOnce(
        stripeFailure('StripeAPIError')
      );
      await expectOnlyAnErrorId(() =>
        service.createCourseCheckoutSession(
          {
            courseId: fx.courseId,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          },
          buyerId
        )
      );
    });

    // A session Stripe does not know is the client's doing (a stale or
    // invented success URL): a warning. An outage or API failure: an error.
    it.each([
      ['StripeInvalidRequestError', 'warn'],
      ['StripeConnectionError', 'error'],
      ['StripeAPIError', 'error'],
    ] as const)('verifying a checkout session (%s, logged at %s)', async (type, level) => {
      vi.mocked(stripe.checkout.sessions.retrieve).mockRejectedValueOnce(
        stripeFailure(type)
      );
      await expectOnlyAnErrorId(
        () => service.verifyCheckoutSession(`cs_rec_${randomUUID()}`, buyerId),
        level
      );
    });

    it('opening the billing portal', async () => {
      vi.mocked(stripe.billingPortal.sessions.create).mockRejectedValueOnce(
        stripeFailure('StripeAPIError')
      );
      await expectOnlyAnErrorId(() =>
        service.createPortalSession(
          'buyer@example.com',
          buyerId,
          'http://localhost:3000/settings'
        )
      );
    });
  });
});
